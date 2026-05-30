import { v2 as cloudinary } from "cloudinary";
import type { UploadApiResponse } from "cloudinary";

import { runtimeConfig as config } from "../../config/env";

cloudinary.config({
  cloud_name: config.cloudinary.cloudName,
  api_key: config.cloudinary.apiKey,
  api_secret: config.cloudinary.apiSecret,
}); //This server belongs to THIS Cloudinary account. Use these credentials for all uploads and operations

export type ResourceType = "image" | "video" | "audio" | "raw";

export interface UploadResultDTO {
  url: string;
  publicId: string;
  fileSize: number;
  mimeType: string;
  resourceType: ResourceType;
}

function getResourceType(mimeType: string): ResourceType {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  return "raw";
}

function getCloudinaryResourceType(
  resourceType: ResourceType,
): "image" | "video" | "raw" {
  switch (resourceType) {
    case "audio":
      return "video";
    case "image":
    case "video":
    case "raw":
      return resourceType;
  }
}

export async function uploadFile(
  buffer: Buffer,
  mimeType: string,
  folder: string,
  userId: string,
): Promise<UploadResultDTO> {
  const resourceType = getResourceType(mimeType);

  const folderPath = `${folder}/${userId}/${resourceType}`;

  const result = await new Promise<UploadApiResponse>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: folderPath,
        resource_type: resourceType === "audio" ? "video" : resourceType,
      },
      (error: unknown, result) => {
        if (error) return reject(error);
        if (!result) return reject(new Error("upload failed:no result"));
        resolve(result);
      },
    );
    stream.end(buffer);
  });

  return {
    url: result.secure_url,
    publicId: result.public_id,
    fileSize: result.bytes,
    mimeType,
    resourceType: mimeType.startsWith("audio/") ? "audio" : resourceType,
  };
} //This function uploads a file buffer to Cloudinary, stores it in a user-specific folder,
//  handles audio correctly, and returns the uploaded file metadata

export async function deleteFile(
  publicId: string,
  resourceType: ResourceType,
): Promise<void> {
  try {
    await cloudinary.uploader.destroy(publicId, {
      resource_type: getCloudinaryResourceType(resourceType),
    });
  } catch (err) {
    console.error(`[UploadService] Failed to delete file ${publicId}:`, err);
  }
}
