export function isPasswordResetEmailConfigured(): boolean {
  const appUrl = process.env.PUBLIC_APP_URL?.trim();
  if (!process.env.RESEND_API_KEY?.trim() || !process.env.MAIL_FROM?.trim() || !appUrl) return false;
  try {
    const url = new URL(appUrl);
    return process.env.NODE_ENV !== "production" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export async function sendPasswordResetEmail(email: string, resetUrl: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.MAIL_FROM?.trim();
  if (!apiKey || !from) {
    throw new Error("RESEND_API_KEY and MAIL_FROM are required to send password reset email.");
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: "Reset your ShareWa password",
      text: `Use this one-time link to reset your ShareWa password. It expires in 30 minutes:\n\n${resetUrl}\n\nIf you did not request this, you can ignore this email.`,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`Password reset email provider returned HTTP ${response.status}.`);
  }
}
