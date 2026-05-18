import mongoose, { Schema } from "mongoose";

const blockSchema = new Schema(
  {
    blocker: { type: Schema.Types.ObjectId, ref: "User", required: true },
    blocked: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

blockSchema.index({ blocker: 1, blocked: 1 }, { unique: true });

blockSchema.index({ blocked: 1, blocker: 1 });

export const Block = mongoose.model("Block", blockSchema);
