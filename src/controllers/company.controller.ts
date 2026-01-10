import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../services/prisma.service";
import { validateName } from "../utils/validation";
import { AuthRequest } from "../middleware/auth.middleware";

// O JWT_SECRET deve ser lido preferencialmente dentro das funções ou garantindo que o dotenv foi carregado
const getSecret = () => process.env.JWT_SECRET || "";

export const createCompany = async (req: AuthRequest, res: Response) => {
  try {
    const { title, cnpj } = req.body;
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    // Validação de campos obrigatórios
    if (!title) {
      return res.status(400).json({
        error: "Nome da empresa é obrigatório",
      });
    }

    // Validação de nome
    const nameValidation = validateName(title);
    if (!nameValidation.valid) {
      return res.status(400).json({ error: nameValidation.message });
    }

    // Verificar se o usuário já tem uma empresa
    const existingCompany = await prisma.company.findFirst({
      where: { ownerId: userId },
    });

    if (existingCompany) {
      return res
        .status(400)
        .json({ error: "Você já possui uma empresa cadastrada" });
    }

    // Normalizar CNPJ: remover formatação (pontos, barras, hífens, espaços)
    const normalizedCnpj = cnpj ? cnpj.replace(/\D/g, "") : null;

    // Verificar se CNPJ já existe (se fornecido)
    if (normalizedCnpj) {
      // Validar se CNPJ tem 14 dígitos
      if (normalizedCnpj.length !== 14) {
        return res.status(400).json({ error: "CNPJ deve conter 14 dígitos" });
      }

      const cnpjExists = await prisma.company.findUnique({
        where: { cnpj: normalizedCnpj },
      });

      if (cnpjExists) {
        return res.status(400).json({ error: "CNPJ já está em uso" });
      }
    }

    // Criar empresa e já adicionar o criador como membro (Dono)
    const company = await prisma.company.create({
      data: {
        title: title.trim(),
        cnpj: normalizedCnpj,
        ownerId: userId,
        members: {
          create: {
            userId: userId,
            role: "OWNER",
            status: "ACTIVE",
          },
        },
      },
    });

    // Criar categoria padrão (Lobby)
    const lobbyCategory = await prisma.roomCategory.create({
      data: {
        title: "Lobby",
        emoji: "🏢",
        companyId: company.id,
      },
    });

    // Criar salas iniciais vinculadas ao Lobby
    await prisma.room.createMany({
      data: [
        {
          title: "Auditório",
          companyId: company.id,
          type: "AUDITORIUM",
          categoryId: null,
        },
        // {
        //   title: "Recepção",
        //   companyId: company.id,
        //   type: "OFFICE",
        //   categoryId: lobbyCategory.id,
        // },
        {
          title: "Chat Aberto",
          companyId: company.id,
          type: "CHAT",
          categoryId: lobbyCategory.id,
        },
      ],
    });

    return res.status(201).json({
      company: {
        id: company.id,
        title: company.title,
        cnpj: company.cnpj,
        createdAt: company.createdAt,
      },
    });
  } catch (error: any) {
    console.error("Erro ao criar empresa:", error);

    // Tratar erros específicos do Prisma
    if (error.code === "P2002") {
      return res.status(400).json({ error: "CNPJ já está em uso" });
    }

    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

export const getMyCompany = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    // Buscar empresa onde o usuário é membro ATIVO ou dono
    const company = await prisma.company.findFirst({
      where: {
        OR: [
          { ownerId: userId },
          {
            members: {
              some: {
                userId,
                status: "ACTIVE", // Apenas membros ativos podem acessar o dashboard
              },
            },
          },
        ],
      },
      include: {
        rooms: true,
        categories: {
          include: {
            rooms: true,
          },
        },
        members: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                picture: true,
              },
            },
          },
        },
      },
    });

    if (!company) {
      return res.status(404).json({ error: "Empresa não encontrada" });
    }

    return res.json({
      company: {
        id: company.id,
        title: company.title,
        cnpj: company.cnpj,
        picture: company.picture,
        createdAt: company.createdAt,
        rooms: company.rooms,
        categories: company.categories,
      },
    });
  } catch (error) {
    console.error("Erro ao buscar empresa:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

export const getPublicCompanyInfo = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const company = await prisma.company.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        picture: true,
        _count: {
          select: { members: true },
        },
      },
    });

    if (!company) {
      return res.status(404).json({ error: "Empresa não encontrada" });
    }

    // Verificar se o usuário já tem uma relação com esta empresa (opcional)
    let membership = null;
    const authHeader = req.headers.authorization;
    const secret = getSecret();

    if (authHeader && secret) {
      try {
        const token = (authHeader as string).startsWith("Bearer ")
          ? (authHeader as string).substring(7)
          : (authHeader as string);

        const decoded = jwt.verify(token, secret) as any;
        const userId = decoded?.userId;

        if (userId) {
          membership = await prisma.companyMember.findFirst({
            where: {
              userId: userId,
              companyId: id,
            },
            select: { status: true, role: true },
          });
        }
      } catch (e) {
        console.error("Token verification failed in public route:", e);
      }
    }

    return res.json({
      company: {
        id: company.id,
        title: company.title,
        picture: company.picture,
        memberCount: company._count.members,
      },
      membership,
    });
  } catch (error) {
    console.error("Erro ao buscar info pública da empresa:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

export const joinCompany = async (req: AuthRequest, res: Response) => {
  try {
    const { id: companyId } = req.params;
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    // Verificar se a empresa existe
    const company = await prisma.company.findUnique({
      where: { id: companyId },
    });

    if (!company) {
      return res.status(404).json({ error: "Empresa não encontrada" });
    }

    // Verificar se já é membro
    const existingMembership = await prisma.companyMember.findUnique({
      where: {
        userId_companyId: {
          userId,
          companyId,
        },
      },
    });

    if (existingMembership) {
      return res.status(400).json({ error: "Você já é membro desta empresa" });
    }

    // Adicionar como membro com status PENDING
    const membership = await prisma.companyMember.create({
      data: {
        userId,
        companyId,
        role: "MEMBER",
        status: "PENDING",
      },
    });

    return res.status(201).json({
      message: "Solicitação enviada! Aguarde a aprovação de um administrador.",
      membership,
    });
  } catch (error) {
    console.error("Erro ao entrar na empresa:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

export const getMembers = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { id: companyId } = req.params;

    if (!userId) {
      return res.status(401).json({ error: "Não autenticado" });
    }

    // Verificar se o usuário tem permissão para ver membros (ADMIN ou OWNER)
    const requester = await prisma.companyMember.findUnique({
      where: {
        userId_companyId: {
          userId,
          companyId,
        },
      },
    });

    if (
      !requester ||
      (requester.role !== "OWNER" && requester.role !== "ADMIN")
    ) {
      return res.status(403).json({ error: "Acesso negado" });
    }

    const members = await prisma.companyMember.findMany({
      where: { companyId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            picture: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return res.json({ members });
  } catch (error) {
    console.error("Erro ao buscar membros:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

export const updateMemberStatus = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { id: companyId, memberId } = req.params;
    const { status, role } = req.body;

    if (!userId) {
      return res.status(401).json({ error: "Não autenticado" });
    }

    // Verificar se o requerente é ADMIN ou OWNER
    const requester = await prisma.companyMember.findUnique({
      where: {
        userId_companyId: {
          userId,
          companyId,
        },
      },
    });

    if (
      !requester ||
      (requester.role !== "OWNER" && requester.role !== "ADMIN")
    ) {
      return res.status(403).json({ error: "Acesso negado" });
    }

    const updatedMember = await prisma.companyMember.update({
      where: { id: memberId },
      data: {
        status,
        role,
      },
    });

    return res.json({
      message: "Membro atualizado com sucesso",
      member: updatedMember,
    });
  } catch (error) {
    console.error("Erro ao atualizar membro:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};
