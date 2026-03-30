import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, date, index, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Re-export auth models
export * from "./models/auth";

// Clients table - businesses/customers using the platform
export const clients = pgTable("clients", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  nome: text("nome").notNull(),
  email: text("email").notNull().unique(),
  telefone: text("telefone"),
  empresa: text("empresa"),
  userId: varchar("user_id"),
  status: text("status").default("ativo").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Locations table - physical locations with cameras
export const locations = pgTable("locations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  nome: text("nome").notNull(),
  endereco: text("endereco"),
  cidade: text("cidade"),
  estado: text("estado"),
  descricao: text("descricao"),
  clienteId: varchar("cliente_id").references(() => clients.id, { onDelete: "cascade" }),
  status: text("status").default("ativo").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Cameras table - IP cameras
export const cameras = pgTable("cameras", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  localidadeId: varchar("localidade_id").references(() => locations.id, { onDelete: "cascade" }),
  nome: text("nome").notNull(),
  marca: text("marca").default("reolink"),
  modelo: text("modelo"),
  hostname: text("hostname").notNull(),
  portaHttp: integer("porta_http").notNull(),
  portaRtsp: integer("porta_rtsp"),
  usuario: text("usuario").notNull(),
  senha: text("senha").notNull(),
  intervaloCaptura: integer("intervalo_captura").default(15).notNull(),
  status: text("status").default("online").notNull(),
  ultimaCaptura: timestamp("ultima_captura"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Captures table - photo captures from cameras
export const captures = pgTable("captures", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  cameraId: varchar("camera_id").references(() => cameras.id, { onDelete: "cascade" }),
  imagemUrl: text("imagem_url").notNull(),
  imagemPath: text("imagem_path").notNull(),
  tamanhoBytes: integer("tamanho_bytes"),
  capturadoEm: timestamp("capturado_em").defaultNow().notNull(),
}, (table) => [
  index("idx_camera_data").on(table.cameraId, table.capturadoEm),
]);

// Client accounts table - login accounts for clients (created by admin)
export const clientAccounts = pgTable("client_accounts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clienteId: varchar("cliente_id").references(() => clients.id, { onDelete: "cascade" }),
  nome: text("nome").notNull(),
  email: text("email").notNull().unique(),
  senhaHash: text("senha_hash").notNull(),
  status: text("status").default("ativo").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Client camera access table - which cameras each client account can see
export const clientCameraAccess = pgTable("client_camera_access", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientAccountId: varchar("client_account_id").notNull().references(() => clientAccounts.id, { onDelete: "cascade" }),
  cameraId: varchar("camera_id").notNull().references(() => cameras.id, { onDelete: "cascade" }),
});

// Timelapses table - generated time-lapse videos
export const timelapses = pgTable("timelapses", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  cameraId: varchar("camera_id").references(() => cameras.id, { onDelete: "cascade" }),
  solicitadoPor: varchar("solicitado_por"),
  nome: text("nome"),
  dataInicio: date("data_inicio").notNull(),
  dataFim: date("data_fim").notNull(),
  fps: integer("fps").default(30).notNull(),
  status: text("status").default("na_fila").notNull(),
  progresso: integer("progresso").default(0).notNull(),
  videoUrl: text("video_url"),
  videoPath: text("video_path"),
  tamanhoBytes: integer("tamanho_bytes"),
  duracaoSegundos: integer("duracao_segundos"),
  totalFrames: integer("total_frames"),
  erroMensagem: text("erro_mensagem"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
});

// Relations
export const clientsRelations = relations(clients, ({ many }) => ({
  locations: many(locations),
  clientAccounts: many(clientAccounts),
}));

export const clientAccountsRelations = relations(clientAccounts, ({ one, many }) => ({
  cliente: one(clients, {
    fields: [clientAccounts.clienteId],
    references: [clients.id],
  }),
  cameraAccess: many(clientCameraAccess),
}));

export const clientCameraAccessRelations = relations(clientCameraAccess, ({ one }) => ({
  clientAccount: one(clientAccounts, {
    fields: [clientCameraAccess.clientAccountId],
    references: [clientAccounts.id],
  }),
  camera: one(cameras, {
    fields: [clientCameraAccess.cameraId],
    references: [cameras.id],
  }),
}));

export const locationsRelations = relations(locations, ({ one, many }) => ({
  cliente: one(clients, {
    fields: [locations.clienteId],
    references: [clients.id],
  }),
  cameras: many(cameras),
}));

export const camerasRelations = relations(cameras, ({ one, many }) => ({
  localidade: one(locations, {
    fields: [cameras.localidadeId],
    references: [locations.id],
  }),
  captures: many(captures),
  timelapses: many(timelapses),
}));

export const capturesRelations = relations(captures, ({ one }) => ({
  camera: one(cameras, {
    fields: [captures.cameraId],
    references: [cameras.id],
  }),
}));

export const timelapsesRelations = relations(timelapses, ({ one }) => ({
  camera: one(cameras, {
    fields: [timelapses.cameraId],
    references: [cameras.id],
  }),
}));

// Insert Schemas
export const insertClientSchema = createInsertSchema(clients).omit({
  id: true,
  createdAt: true,
});

export const insertLocationSchema = createInsertSchema(locations).omit({
  id: true,
  createdAt: true,
});

export const insertCameraSchema = createInsertSchema(cameras).omit({
  id: true,
  createdAt: true,
  ultimaCaptura: true,
});

export const insertCaptureSchema = createInsertSchema(captures).omit({
  id: true,
  capturadoEm: true,
});

export const insertTimelapseSchema = createInsertSchema(timelapses).omit({
  id: true,
  createdAt: true,
  completedAt: true,
  progresso: true,
  videoUrl: true,
  videoPath: true,
  tamanhoBytes: true,
  duracaoSegundos: true,
  totalFrames: true,
  erroMensagem: true,
});

export const insertClientAccountSchema = createInsertSchema(clientAccounts).omit({
  id: true,
  createdAt: true,
  senhaHash: true,
}).extend({
  senha: z.string().min(6, "Senha deve ter pelo menos 6 caracteres"),
  cameraIds: z.array(z.string()).optional(),
});

export const insertClientCameraAccessSchema = createInsertSchema(clientCameraAccess).omit({
  id: true,
});

// Types
export type InsertClient = z.infer<typeof insertClientSchema>;
export type Client = typeof clients.$inferSelect;

export type InsertLocation = z.infer<typeof insertLocationSchema>;
export type Location = typeof locations.$inferSelect;

export type InsertCamera = z.infer<typeof insertCameraSchema>;
export type Camera = typeof cameras.$inferSelect;

export type InsertCapture = z.infer<typeof insertCaptureSchema>;
export type Capture = typeof captures.$inferSelect;

export type InsertTimelapse = z.infer<typeof insertTimelapseSchema>;
export type Timelapse = typeof timelapses.$inferSelect;

export type InsertClientAccount = z.infer<typeof insertClientAccountSchema>;
export type ClientAccount = typeof clientAccounts.$inferSelect;
export type ClientCameraAccess = typeof clientCameraAccess.$inferSelect;
export type ClientAccountWithRelations = ClientAccount & {
  cliente: Client | null;
  cameraAccess: (ClientCameraAccess & { camera: Camera | null })[];
};

// Extended types with relations
export type LocationWithClient = Location & { cliente?: Client };
export type CameraWithLocation = Camera & { localidade?: LocationWithClient };
export type CaptureWithCamera = Capture & { camera?: Camera };
export type TimelapseWithCamera = Timelapse & { camera?: Camera };
