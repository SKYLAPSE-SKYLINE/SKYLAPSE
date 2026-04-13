import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { Readable } from "stream";

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID!;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID!;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY!;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || "skylapse";

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

export async function uploadToR2(key: string, body: Buffer, contentType = "image/jpeg"): Promise<void> {
  await s3.send(new PutObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key,
    Body: body,
    ContentType: contentType,
  }));
}

export async function getFromR2(key: string): Promise<Buffer> {
  const res = await s3.send(new GetObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key,
  }));
  const stream = res.Body as Readable;
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function getStreamFromR2(key: string): Promise<{ stream: Readable; contentType?: string }> {
  const res = await s3.send(new GetObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key,
  }));
  return {
    stream: res.Body as Readable,
    contentType: res.ContentType,
  };
}

export async function deleteFromR2(key: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key,
  }));
}

export async function existsInR2(key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
    }));
    return true;
  } catch {
    return false;
  }
}
