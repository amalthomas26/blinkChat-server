import { Request, Response } from "express";

import { asyncHandler } from "../../middleware/asyncHandler";
import { ApiError } from "../../utils/ApiError";

import { sendOtp, verifyOtp, issueVerifiedToken } from "./otp.service";
import { OTP_PURPOSES, OtpPurpose } from "./otpToken.model";


function assertValidPurpose(purpose: unknown): asserts purpose is OtpPurpose {

    if (
        typeof purpose !== "string" ||
        !OTP_PURPOSES.includes(purpose as OtpPurpose)
    )
        throw new ApiError(400, `Invalid purpose. Must be one of: ${OTP_PURPOSES.join(", ")}`);

}

export const sendOtpController = asyncHandler(
    async (req: Request, res: Response) => {

        const { email, purpose } = req.body;

        if (!email || typeof email !== "string")
            throw new ApiError(400, "Email is required");

        assertValidPurpose(purpose);

        await sendOtp(email, purpose);


        return res.status(200).json({
            success: true,
            message: "If the email is valid,a verification code has been sent"
        });


    },
);

export const verifyOtpController = asyncHandler(
    async (req: Request, res: Response) => {
        const { email, code, purpose } = req.body;
        if (!email || typeof email !== "string") {
            throw new ApiError(400, "Email is required");
        }
        if (!code || typeof code !== "string") {
            throw new ApiError(400, "OTP code is required");
        }
        // Sanitize: only digits, exactly 6 characters
        if (!/^\d{6}$/.test(code)) {
            throw new ApiError(400, "OTP must be a 6-digit number");
        }
        assertValidPurpose(purpose);
        await verifyOtp(email, code, purpose);
        // Issue a proof token that the caller uses in the next step
        const verifiedToken = issueVerifiedToken(email, purpose);
        return res.status(200).json({
            success: true,
            data: { verifiedToken },
        });
    },
);