import dotenv from "dotenv";
import path from "path";

dotenv.config({
  path: path.join(path.resolve(), ".env"),
});

export const DB_HOST = process.env.DB_HOST;
export const DB_USER = process.env.DB_USER;
export const DB_PW = process.env.DB_PW;
export const OUTPUT_DIR = process.env.OUTPUT_DIR || "./";
