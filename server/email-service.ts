import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "SkyLapse <onboarding@resend.dev>";
const PORTAL_URL = process.env.PORTAL_URL || "http://localhost:3000";

export async function sendWelcomeEmail(params: {
  nome: string;
  email: string;
  senha: string;
  clienteNome?: string;
}): Promise<{ success: boolean; error?: string }> {
  if (!resend) {
    console.log(`[email] RESEND_API_KEY não configurada — email de boas-vindas não enviado para ${params.email}`);
    return { success: false, error: "Serviço de e-mail não configurado" };
  }

  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: params.email,
      subject: "Bem-vindo ao SkyLapse — Seus dados de acesso",
      html: buildWelcomeHtml(params),
    });

    if (error) {
      console.error("[email] Erro ao enviar:", error);
      return { success: false, error: error.message };
    }

    console.log(`[email] E-mail de boas-vindas enviado para ${params.email} (id: ${data?.id})`);
    return { success: true };
  } catch (err: any) {
    console.error("[email] Erro inesperado:", err.message);
    return { success: false, error: err.message };
  }
}

export async function sendPasswordResetEmail(params: {
  nome: string;
  email: string;
  resetUrl: string;
}): Promise<{ success: boolean; error?: string }> {
  if (!resend) {
    console.log(`[email] Reset URL: ${params.resetUrl}`);
    return { success: false, error: "Serviço de e-mail não configurado" };
  }

  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: params.email,
      subject: "SkyLapse — Redefinição de senha",
      html: buildResetHtml(params),
    });

    if (error) {
      console.error("[email] Erro ao enviar reset:", error);
      return { success: false, error: error.message };
    }

    console.log(`[email] E-mail de reset enviado para ${params.email} (id: ${data?.id})`);
    return { success: true };
  } catch (err: any) {
    console.error("[email] Erro inesperado:", err.message);
    return { success: false, error: err.message };
  }
}

export async function sendCameraOfflineEmail(params: {
  cameraNome: string;
}): Promise<void> {
  if (!resend || !process.env.ADMIN_NOTIFICATION_EMAIL) return;

  const now = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const cameraNome = escapeHtml(params.cameraNome);
  const portalUrl = PORTAL_URL.startsWith("http") ? PORTAL_URL : "#";

  await resend.emails.send({
    from: FROM_EMAIL,
    to: process.env.ADMIN_NOTIFICATION_EMAIL,
    subject: `Câmera offline — ${params.cameraNome}`,
    html: `
      <div style="font-family:sans-serif;background:#0a0e17;color:#f9fafb;padding:32px;border-radius:12px;max-width:480px;">
        <h2 style="color:#f87171;margin:0 0 16px;">Câmera Offline</h2>
        <p style="color:#9ca3af;margin:0 0 8px;">A câmera <strong style="color:#f9fafb;">${cameraNome}</strong> parou de responder.</p>
        <p style="color:#9ca3af;margin:0 0 24px;">Detectado em: <strong style="color:#f9fafb;">${now}</strong></p>
        <a href="${portalUrl}/admin/cameras" style="background:#2563eb;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">Ver no Portal</a>
      </div>`,
  }).catch(console.error);
}

function buildResetHtml(params: { nome: string; resetUrl: string }): string {
  const nome = escapeHtml(params.nome);
  // resetUrl is only used in href — validate it's http/https to prevent javascript: URIs
  const resetUrl = params.resetUrl.startsWith("http") ? params.resetUrl : "#";
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#0a0e17;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0a0e17;padding:40px 20px;">
    <tr><td align="center">
      <table width="500" cellpadding="0" cellspacing="0" style="background-color:#111827;border-radius:16px;border:1px solid #1f2937;overflow:hidden;">
        <tr>
          <td style="background:linear-gradient(135deg,#1e40af,#3b82f6);padding:32px 40px;text-align:center;">
            <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;">SkyLapse</h1>
            <p style="margin:8px 0 0;color:rgba(255,255,255,0.8);font-size:14px;">Monitoramento Inteligente de Obras</p>
          </td>
        </tr>
        <tr>
          <td style="padding:40px;">
            <h2 style="margin:0 0 8px;color:#f9fafb;font-size:20px;font-weight:600;">Ola, ${nome}!</h2>
            <p style="margin:0 0 24px;color:#9ca3af;font-size:14px;line-height:1.6;">
              Recebemos uma solicitacao de redefinicao de senha para sua conta. Clique no botao abaixo para criar uma nova senha. O link expira em <strong style="color:#e5e7eb;">1 hora</strong>.
            </p>
            <a href="${resetUrl}" style="display:block;background:linear-gradient(135deg,#2563eb,#3b82f6);color:#ffffff;text-decoration:none;text-align:center;padding:14px 24px;border-radius:10px;font-size:14px;font-weight:600;">
              Redefinir Senha
            </a>
            <p style="margin:24px 0 0;color:#6b7280;font-size:12px;line-height:1.5;">
              Se voce nao solicitou a redefinicao, ignore este e-mail. Sua senha permanece a mesma.
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 40px;border-top:1px solid #1f2937;text-align:center;">
            <p style="margin:0;color:#4b5563;font-size:11px;">SkyLapse — Monitoramento Inteligente de Obras</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildWelcomeHtml(params: {
  nome: string;
  email: string;
  senha: string;
  clienteNome?: string;
}): string {
  const nome = escapeHtml(params.nome);
  const email = escapeHtml(params.email);
  const senha = escapeHtml(params.senha);
  const clienteNome = params.clienteNome ? escapeHtml(params.clienteNome) : undefined;
  const portalUrl = PORTAL_URL.startsWith("http") ? PORTAL_URL : "#";
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#0a0e17;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0a0e17;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="500" cellpadding="0" cellspacing="0" style="background-color:#111827;border-radius:16px;border:1px solid #1f2937;overflow:hidden;">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#1e40af,#3b82f6);padding:32px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;letter-spacing:-0.5px;">SkyLapse</h1>
              <p style="margin:8px 0 0;color:rgba(255,255,255,0.8);font-size:14px;">Monitoramento Inteligente de Obras</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px;">
              <h2 style="margin:0 0 8px;color:#f9fafb;font-size:20px;font-weight:600;">Ola, ${nome}!</h2>
              <p style="margin:0 0 24px;color:#9ca3af;font-size:14px;line-height:1.6;">
                Sua conta no portal SkyLapse foi criada com sucesso.${clienteNome ? ` Voce esta vinculado ao cliente <strong style="color:#e5e7eb;">${clienteNome}</strong>.` : ""}
              </p>

              <!-- Credentials box -->
              <div style="background-color:#1f2937;border-radius:12px;padding:24px;margin-bottom:24px;border:1px solid #374151;">
                <p style="margin:0 0 16px;color:#9ca3af;font-size:12px;text-transform:uppercase;letter-spacing:1px;font-weight:600;">Dados de acesso</p>

                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="padding:8px 0;color:#9ca3af;font-size:13px;width:60px;">E-mail</td>
                    <td style="padding:8px 0;color:#f9fafb;font-size:14px;font-weight:500;">${email}</td>
                  </tr>
                  <tr>
                    <td style="padding:8px 0;color:#9ca3af;font-size:13px;">Senha</td>
                    <td style="padding:8px 0;">
                      <code style="background-color:#0a0e17;color:#60a5fa;padding:4px 10px;border-radius:6px;font-size:14px;font-weight:500;border:1px solid #1e3a5f;">${senha}</code>
                    </td>
                  </tr>
                </table>
              </div>

              <!-- CTA Button -->
              <a href="${portalUrl}/cliente"
                 style="display:block;background:linear-gradient(135deg,#2563eb,#3b82f6);color:#ffffff;text-decoration:none;text-align:center;padding:14px 24px;border-radius:10px;font-size:14px;font-weight:600;letter-spacing:0.3px;">
                Acessar o Portal
              </a>

              <p style="margin:24px 0 0;color:#6b7280;font-size:12px;line-height:1.5;">
                Recomendamos que voce altere sua senha apos o primeiro acesso. Se voce nao solicitou esta conta, ignore este e-mail.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 40px;border-top:1px solid #1f2937;text-align:center;">
              <p style="margin:0;color:#4b5563;font-size:11px;">SkyLapse — Monitoramento Inteligente de Obras</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
