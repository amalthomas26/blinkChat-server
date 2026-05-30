import { Resend } from "resend";

import { ApiError } from "../../utils/ApiError";


let resendClient: Resend | null = null;

function getResendClient(): Resend {
    if (resendClient) return resendClient;


    const apiKey = process.env.RESEND_API_KEY;

    if (!apiKey)
        throw new ApiError(500, "Resend API key is not configured")

    resendClient = new Resend(apiKey)

    return resendClient;

}


export async function sendOtpEmail(
    to: string,
    otp: string,
    purpose: "email_verification" | "forgot_password" | "login_2fa"
): Promise<void> {

    const subjectMap = {
        email_verification: "BlinkChat - Verify Your Email",
        forgot_password: "BlinkChat - Reset your password",
        login_2fa: "BlinkChat - Your login verification code",
    } as const;

    const purposeTextMap = {
        email_verification: "verify your email address",
        forgot_password: "reset your password",
        login_2fa: "complete your login",
    } as const;



    const subject = subjectMap[purpose];
    const purposeText = purposeTextMap[purpose];

    // Plain text fallback (for email clients that don't render HTML)
    const text = `Your BlinkChat verification code is: ${otp}\n\nThis code expires in 10 minutes.\nIf you didn't request this, please ignore this email.`;
    // Styled HTML email
    const html = `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px; background: #0b0f19; border-radius: 16px; color: #e2e8f0;">
      <div style="text-align: center; margin-bottom: 24px;">
        <div style="display: inline-block; width: 48px; height: 48px; background: #8b5cf6; border-radius: 12px; line-height: 48px; font-size: 24px; color: white;">💬</div>
      </div>
      <h2 style="text-align: center; color: #ffffff; margin-bottom: 8px; font-size: 20px;">
        ${subject.replace("BlinkChat — ", "")}
      </h2>
      <p style="text-align: center; color: #94a3b8; font-size: 14px; margin-bottom: 24px;">
        Use the code below to ${purposeText}
      </p>
      <div style="background: #1d2635; border-radius: 12px; padding: 20px; text-align: center; margin-bottom: 24px;">
        <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #8b5cf6;">
          ${otp}
        </span>
      </div>
      <p style="text-align: center; color: #64748b; font-size: 12px;">
        This code expires in <strong>10 minutes</strong>.<br/>
        If you didn't request this, please ignore this email.
      </p>
    </div>
  `;

    const fromAddress = process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";

    const { error } = await getResendClient().emails.send({
        from: `BlinkChat <${fromAddress}>`,
        to: [to],
        subject,
        text,
        html,


    });


    if (error) {
        console.error("[sendOtpEmail] Resend error:", error);
        throw new ApiError(500, `Email delivery failed: ${error.message}`);
    }

}