import mongoose, { Schema, Document } from "mongoose";

export const OTP_PURPOSES = [
    "email_verification",
    "forgot_password",
    "login_2fa"
] as const;

export type OtpPurpose = (typeof OTP_PURPOSES)[number];


export interface IOtpToken extends Document {
    email: string;
    otp: string;
    purpose: OtpPurpose;
    expiresAt: Date;
    verified: boolean;
    attempts: number;
}

const otpTokenSchema = new Schema<IOtpToken>(
    {
        email: {
            type: String,
            required: true,
            lowercase: true,
            trim: true,
            index: true,
        },
        otp: {
            type: String,
            required: true,
        },
        purpose: {
            type: String,
            required: true,
            enum: OTP_PURPOSES,

        }, expiresAt: {
            type: Date,
            required: true,
        },
        verified: {
            type: Boolean,
            default: false,
        },
        attempts: {
            type: Number,
            default: 0,
        },
    },
    {
        timestamps: true,
    }
)

otpTokenSchema.index({ email: 1, purpose: 1 });

// TTL index: MongoDB auto-deletes OTP documents when expiresAt is reached.
// { expireAfterSeconds: 0 } = delete at exactly the expiresAt timestamp.
otpTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model<IOtpToken>("OtpToken", otpTokenSchema);