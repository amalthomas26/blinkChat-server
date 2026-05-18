import mongoose from "mongoose";

export const connectDB = async () => {
  const mongoUri = process.env.MONGO_URI;

  if (!mongoUri) {
    throw new Error("MONGO_URI is not configured");
  }

  const conn = await mongoose.connect(mongoUri);
  console.log(
    `MongoDB Connected: ${conn.connection.name} @ ${conn.connection.host}`,
  );

  return conn;
};
