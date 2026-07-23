import "dotenv/config";
import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "Pingr <onboarding@resend.dev>";

export class EmailService {
  static async sendCompanyInvite(params: {
    to: string;
    companyName: string;
    inviterName: string;
    acceptUrl: string;
  }): Promise<void> {
    if (!resend) {
      throw new Error("RESEND_API_KEY não configurado");
    }

    const { to, companyName, inviterName, acceptUrl } = params;

    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject: `${inviterName} convidou você para ${companyName} no Pingr`,
      html: `
        <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">
          <p style="font-size: 20px; font-weight: 700; margin: 0 0 24px;">
            pingr<span style="color:#22c55e;">.</span>
          </p>
          <h1 style="font-size: 20px; margin: 0 0 16px;">Você foi convidado para ${companyName}</h1>
          <p style="color: #555; line-height: 1.5;">
            ${inviterName} convidou você para fazer parte do time de <strong>${companyName}</strong> no Pingr,
            o escritório virtual da empresa.
          </p>
          <a href="${acceptUrl}"
             style="display:inline-block; margin-top: 20px; padding: 12px 24px; background:#22c55e; color:#0a0a0a; font-weight:600; text-decoration:none; border-radius:8px;">
            Aceitar convite
          </a>
          <p style="color: #999; font-size: 12px; margin-top: 24px;">
            Este convite expira em 7 dias. Se você não esperava este e-mail, pode ignorá-lo.
          </p>
        </div>
      `,
    });

    if (error) {
      throw new Error(`Erro ao enviar e-mail via Resend: ${error.message}`);
    }
  }
}
