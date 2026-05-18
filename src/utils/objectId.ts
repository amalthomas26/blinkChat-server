import { Types } from "mongoose";

/**
 * Accepts string or ObjectId — matches the signature of mongoose.Types.ObjectId.isValid.
 * Use this everywhere instead of calling mongoose.Types.ObjectId.isValid inline.
 */

export const isValidObjectId = (id: unknown): id is Types.ObjectId | string => {
  if (id instanceof Types.ObjectId) return true;
  return typeof id === "string" && Types.ObjectId.isValid(id);
};