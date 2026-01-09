import { Response } from "express";
import { prisma } from "../services/prisma.service";
import { validateName } from "../utils/validation";
import { AuthRequest } from "../middleware/auth.middleware";

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
        error: "Nome da empresa é obrigatório"
      });
    }

    // Validação de nome
    const nameValidation = validateName(title);
    if (!nameValidation.valid) {
      return res.status(400).json({ error: nameValidation.message });
    }

    // Verificar se o usuário já tem uma empresa
    const existingCompany = await prisma.company.findFirst({
      where: { userId },
    });

    if (existingCompany) {
      return res.status(400).json({ error: "Você já possui uma empresa cadastrada" });
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

    // Criar empresa
    const company = await prisma.company.create({
      data: {
        title: title.trim(),
        cnpj: normalizedCnpj,
        userId,
      },
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

    const company = await prisma.company.findFirst({
      where: { userId },
      include: {
        rooms: true,
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
      },
    });
  } catch (error) {
    console.error("Erro ao buscar empresa:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

