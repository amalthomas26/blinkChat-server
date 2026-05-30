import crypto from "crypto";

import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

import { ApiError } from "../../utils/ApiError";
import { getOtpProofSecret } from "../../utils/token.utils";

import { sendOtpEmail } from "./email.services";
import OtpToken, { OtpPurpose } from "./otpToken.model";


const OTP_EXPIRY_MINUTES   = Number(process.env.OTP_EXPIRY_MINUTES)   || 10;
const MAX_ATTEMPTS         = Number(process.env.MAX_ATTEMPTS)          || 5;
const MAX_SENDS_PER_WINDOW = Number(process.env.MAX_SENDS_PER_WINDOW)  || 3;
const VERIFIED_TOKEN_EXPIRY = process.env.VERIFIED_TOKEN_EXPIRY ?? "15m"; // must be string for jwt.sign
const BCRYPT_ROUNDS        = Number(process.env.BCRYPT_ROUNDS)         || 10;



export async function sendOtp(
    email: string,
    purpose: OtpPurpose,
): Promise<void> {

    const normalizedEmail = email.trim().toLowerCase();


    const windowStart = new Date(
        Date.now() - Number(OTP_EXPIRY_MINUTES) * 60 * 1000,

    );

    const recentCount = await OtpToken.countDocuments({
        email: normalizedEmail,
        purpose,
        createdAt: { $gte: windowStart },
    });

    if (recentCount >= MAX_SENDS_PER_WINDOW)
        throw new ApiError(
            429,
            "Too many OTP requests. Please wait before requesting a new code.",
        );


    await OtpToken.updateMany(
        { email: normalizedEmail, purpose, verified: false },
        { $set: { verified: true } },
    );

    const rawOtp = crypto.randomInt(100_000, 999_999).toString();

    const hashedOtp = await bcrypt.hash(rawOtp, BCRYPT_ROUNDS);


    // Send email FIRST — only save to DB if delivery succeeds.
    // This prevents consuming a rate-limit slot for a code the user never received.
    try {
        await sendOtpEmail(normalizedEmail, rawOtp, purpose);
    } catch (err) {
        console.error("[sendOtp] Email delivery failed:", err);
        throw new ApiError(
            500,
            "Failed to send verification email. Please try again.",
        );
    }

    await OtpToken.create({
        email: normalizedEmail,
        otp: hashedOtp,
        purpose,
        expiresAt: new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000),
        verified: false,
        attempts: 0,
    });

};

export async function verifyOtp(
    email: string,
    code: string,
    purpose: OtpPurpose
): Promise<void> {

    const normalizedEmail = email.trim().toLowerCase();


    const otpDoc = await OtpToken.findOne({
        email: normalizedEmail,
        purpose,
        verified: false,
        expiresAt: { $gt: new Date() },
    }).sort({ createdAt: -1 });



    if (!otpDoc) throw new ApiError(
        400,
        "OTP expired or not requested. Please request a new code.",
    );


    if (otpDoc.attempts >= MAX_ATTEMPTS)
        throw new ApiError(
            429,
            "Too many incorrect attempts. Please request a new code.",
        );


    const isMatch = await bcrypt.compare(code, otpDoc.otp);


    if (!isMatch) {

        await OtpToken.updateOne(
            { _id: otpDoc._id },
            { $inc: { attempts: 1 } },
        );
        const remaining = MAX_ATTEMPTS - otpDoc.attempts - 1;
        throw new ApiError(
            400,
            `Invalid OTP. ${remaining} attempt${remaining !== 1 ? "s" : ""} remaining.`,
        );
    }

    await OtpToken.updateOne(
        { _id: otpDoc._id },
        { $set: { verified: true } },
    );


}



export function issueVerifiedToken(
    email: string,
    purpose: OtpPurpose,

): string {
    return jwt.sign(
        {
            email: email.trim().toLowerCase(),
            purpose,
            type: "otp_proof",
            nonce: crypto.randomUUID(),
        },
        getOtpProofSecret(),
        { expiresIn: VERIFIED_TOKEN_EXPIRY as import("jsonwebtoken").SignOptions["expiresIn"] },
    )
}

export function validateVerifiedToken(
    token: string,
    expectedPurpose: OtpPurpose,
    expectedEmail: string,
): { email: string; purpose: OtpPurpose; nonce: string } {
    try {
        const decoded = jwt.verify(token, getOtpProofSecret()) as {
            email: string;
            purpose: OtpPurpose;
            type: string;
            nonce: string;
        };

        if (decoded.type !== "otp_proof") {
            throw new ApiError(400, "Invalid verification token");
        }

        if (decoded.purpose !== expectedPurpose) {
            throw new ApiError(400, "Verification token purpose mismatch");
        }

        const normalizedExpected = expectedEmail.trim().toLowerCase();
        if (decoded.email !== normalizedExpected) {
            throw new ApiError(400, "Verification token email mismatch");
        }
        return decoded;
    } catch (err) {
        if (err instanceof ApiError) throw err;

        throw new ApiError(400, "Invalid or expired verification token");
    }
}



