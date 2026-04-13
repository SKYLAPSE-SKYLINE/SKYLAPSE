import { 
  clients, locations, cameras, captures, timelapses,
  clientAccounts, clientCameraAccess, adminAccounts,
  type Client, type InsertClient,
  type Location, type InsertLocation,
  type Camera, type InsertCamera,
  type Capture, type InsertCapture,
  type Timelapse, type InsertTimelapse,
  type ClientAccount, type ClientAccountWithRelations,
  type AdminAccount,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, and, gte, lte, sql } from "drizzle-orm";

export interface IStorage {
  // Clients
  getClients(): Promise<Client[]>;
  getClient(id: string): Promise<Client | undefined>;
  createClient(client: InsertClient): Promise<Client>;
  updateClient(id: string, client: Partial<InsertClient>): Promise<Client | undefined>;
  deleteClient(id: string): Promise<boolean>;

  // Locations
  getLocations(): Promise<(Location & { cliente?: Client })[]>;
  getLocation(id: string): Promise<Location | undefined>;
  createLocation(location: InsertLocation): Promise<Location>;
  updateLocation(id: string, location: Partial<InsertLocation>): Promise<Location | undefined>;
  deleteLocation(id: string): Promise<boolean>;

  // Cameras
  getCameras(): Promise<(Camera & { localidade?: Location & { cliente?: Client } })[]>;
  getCamera(id: string): Promise<Camera | undefined>;
  getOfflineCameras(): Promise<Camera[]>;
  createCamera(camera: InsertCamera): Promise<Camera>;
  updateCamera(id: string, camera: Partial<InsertCamera>): Promise<Camera | undefined>;
  deleteCamera(id: string): Promise<boolean>;

  // Captures
  getCaptures(cameraId: string, dataInicio?: string, dataFim?: string, page?: number, limit?: number): Promise<{ data: Capture[]; total: number }>;
  getAllCaptures(cameraId: string, dataInicio?: string, dataFim?: string): Promise<Capture[]>;
  getLastCapture(cameraId: string): Promise<Capture | undefined>;
  createCapture(capture: InsertCapture): Promise<Capture>;
  deleteCapture(id: string): Promise<Capture | undefined>;
  getTodayCapturesCount(): Promise<number>;

  // Timelapses
  getTimelapses(): Promise<(Timelapse & { camera?: Camera })[]>;
  getTimelapse(id: string): Promise<Timelapse | undefined>;
  getRecentTimelapses(limit?: number): Promise<Timelapse[]>;
  getProcessingTimelapsesCount(): Promise<number>;
  createTimelapse(timelapse: InsertTimelapse): Promise<Timelapse>;
  updateTimelapse(id: string, timelapse: Partial<Timelapse>): Promise<Timelapse | undefined>;
  deleteTimelapse(id: string): Promise<boolean>;

  // Client Accounts
  getClientAccounts(): Promise<ClientAccountWithRelations[]>;
  getClientAccount(id: string): Promise<ClientAccountWithRelations | undefined>;
  getClientAccountStatus(id: string): Promise<Pick<ClientAccount, "id" | "status"> | undefined>;
  getClientAccountByEmail(email: string): Promise<ClientAccount | undefined>;
  createClientAccount(data: { clienteId?: string | null; nome: string; email: string; senhaHash: string; status?: string }): Promise<ClientAccount>;
  updateClientAccount(id: string, data: Partial<{ clienteId: string | null; nome: string; email: string; senhaHash: string; status: string }>): Promise<ClientAccount | undefined>;
  deleteClientAccount(id: string): Promise<boolean>;
  setClientCameraAccess(clientAccountId: string, cameraIds: string[]): Promise<void>;
  getClientCameraIds(clientAccountId: string): Promise<string[]>;
  updateClientPassword(id: string, senhaHash: string): Promise<void>;
  incrementClientTokenVersion(id: string): Promise<void>;
  incrementAdminTokenVersion(id: string): Promise<void>;
  getClientAccountByResetToken(token: string): Promise<ClientAccount | undefined>;
  setResetToken(id: string, token: string, expiry: Date): Promise<void>;
  clearResetToken(id: string): Promise<void>;

  // Admin Accounts
  getAdminAccounts(): Promise<Omit<AdminAccount, "senhaHash">[]>;
  getAdminAccount(id: string): Promise<AdminAccount | undefined>;
  getAdminAccountByEmail(email: string): Promise<AdminAccount | undefined>;
  createAdminAccount(data: { nome: string; email: string; senhaHash: string }): Promise<AdminAccount>;
  updateAdminAccount(id: string, data: Partial<{ nome: string; email: string; senhaHash: string }>): Promise<AdminAccount | undefined>;
  deleteAdminAccount(id: string): Promise<boolean>;
  countAdminAccounts(): Promise<number>;

  // Dashboard extra
  getDashboardExtra(): Promise<{
    activityDays: { dia: string; total: number }[];
    totalCaptures: number;
  }>;

  // Stats
  getStats(): Promise<{
    totalClients: number;
    activeClients: number;
    totalCameras: number;
    onlineCameras: number;
    offlineCameras: number;
    todayCaptures: number;
    processingTimelapses: number;
  }>;
}

export class DatabaseStorage implements IStorage {
  // Clients
  async getClients(): Promise<Client[]> {
    return await db.select().from(clients).orderBy(desc(clients.createdAt));
  }

  async getClient(id: string): Promise<Client | undefined> {
    const [client] = await db.select().from(clients).where(eq(clients.id, id));
    return client;
  }

  async createClient(client: InsertClient): Promise<Client> {
    const [newClient] = await db.insert(clients).values(client).returning();
    return newClient;
  }

  async updateClient(id: string, client: Partial<InsertClient>): Promise<Client | undefined> {
    const [updated] = await db.update(clients).set(client).where(eq(clients.id, id)).returning();
    return updated;
  }

  async deleteClient(id: string): Promise<boolean> {
    const result = await db.delete(clients).where(eq(clients.id, id)).returning();
    return result.length > 0;
  }

  // Locations
  async getLocations(): Promise<(Location & { cliente?: Client })[]> {
    const result = await db.query.locations.findMany({
      with: { cliente: true },
      orderBy: desc(locations.createdAt),
    });
    return result;
  }

  async getLocation(id: string): Promise<Location | undefined> {
    const [location] = await db.select().from(locations).where(eq(locations.id, id));
    return location;
  }

  async createLocation(location: InsertLocation): Promise<Location> {
    const [newLocation] = await db.insert(locations).values(location).returning();
    return newLocation;
  }

  async updateLocation(id: string, location: Partial<InsertLocation>): Promise<Location | undefined> {
    const [updated] = await db.update(locations).set(location).where(eq(locations.id, id)).returning();
    return updated;
  }

  async deleteLocation(id: string): Promise<boolean> {
    const result = await db.delete(locations).where(eq(locations.id, id)).returning();
    return result.length > 0;
  }

  // Cameras
  async getCameras(): Promise<(Camera & { localidade?: Location & { cliente?: Client } })[]> {
    const result = await db.query.cameras.findMany({
      with: { 
        localidade: {
          with: { cliente: true }
        }
      },
      orderBy: desc(cameras.createdAt),
    });
    return result;
  }

  async getCamera(id: string): Promise<Camera | undefined> {
    const [camera] = await db.select().from(cameras).where(eq(cameras.id, id));
    return camera;
  }

  async getOfflineCameras(): Promise<Camera[]> {
    return await db.select().from(cameras).where(eq(cameras.status, "offline"));
  }

  async createCamera(camera: InsertCamera): Promise<Camera> {
    const [newCamera] = await db.insert(cameras).values(camera).returning();
    return newCamera;
  }

  async updateCamera(id: string, camera: Partial<InsertCamera>): Promise<Camera | undefined> {
    const [updated] = await db.update(cameras).set(camera).where(eq(cameras.id, id)).returning();
    return updated;
  }

  async deleteCamera(id: string): Promise<boolean> {
    const result = await db.delete(cameras).where(eq(cameras.id, id)).returning();
    return result.length > 0;
  }

  // Captures
  async getCaptures(cameraId: string, dataInicio?: string, dataFim?: string, page = 1, limit = 50): Promise<{ data: Capture[]; total: number }> {
    let conditions = [eq(captures.cameraId, cameraId)];

    if (dataInicio) {
      conditions.push(gte(captures.capturadoEm, new Date(dataInicio)));
    }
    if (dataFim) {
      const endDate = new Date(dataFim);
      endDate.setHours(23, 59, 59, 999);
      conditions.push(lte(captures.capturadoEm, endDate));
    }

    const whereClause = and(...conditions);
    const [countResult] = await db.select({ count: sql<number>`count(*)` }).from(captures).where(whereClause);
    const total = Number(countResult.count);

    const data = await db.select()
      .from(captures)
      .where(whereClause)
      .orderBy(desc(captures.capturadoEm))
      .limit(limit)
      .offset((page - 1) * limit);

    return { data, total };
  }

  async getAllCaptures(cameraId: string, dataInicio?: string, dataFim?: string): Promise<Capture[]> {
    let conditions = [eq(captures.cameraId, cameraId)];
    if (dataInicio) {
      conditions.push(gte(captures.capturadoEm, new Date(dataInicio)));
    }
    if (dataFim) {
      const endDate = new Date(dataFim);
      endDate.setHours(23, 59, 59, 999);
      conditions.push(lte(captures.capturadoEm, endDate));
    }
    return await db.select()
      .from(captures)
      .where(and(...conditions))
      .orderBy(desc(captures.capturadoEm));
  }

  async getLastCapture(cameraId: string): Promise<Capture | undefined> {
    const [capture] = await db.select()
      .from(captures)
      .where(eq(captures.cameraId, cameraId))
      .orderBy(desc(captures.capturadoEm))
      .limit(1);
    return capture;
  }

  async createCapture(capture: InsertCapture): Promise<Capture> {
    const [newCapture] = await db.insert(captures).values(capture).returning();
    return newCapture;
  }

  async deleteCapture(id: string): Promise<Capture | undefined> {
    const [deleted] = await db.delete(captures).where(eq(captures.id, id)).returning();
    return deleted;
  }

  async getTodayCapturesCount(): Promise<number> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const result = await db.select({ count: sql<number>`count(*)` })
      .from(captures)
      .where(gte(captures.capturadoEm, today));
    
    return Number(result[0]?.count) || 0;
  }

  // Timelapses
  async getTimelapses(): Promise<(Timelapse & { camera?: Camera })[]> {
    const result = await db.query.timelapses.findMany({
      with: { camera: true },
      orderBy: desc(timelapses.createdAt),
    });
    return result;
  }

  async getTimelapse(id: string): Promise<Timelapse | undefined> {
    const [timelapse] = await db.select().from(timelapses).where(eq(timelapses.id, id));
    return timelapse;
  }

  async getRecentTimelapses(limit: number = 5): Promise<Timelapse[]> {
    return await db.select()
      .from(timelapses)
      .orderBy(desc(timelapses.createdAt))
      .limit(limit);
  }

  async getProcessingTimelapsesCount(): Promise<number> {
    const result = await db.select({ count: sql<number>`count(*)` })
      .from(timelapses)
      .where(eq(timelapses.status, "processando"));
    
    return Number(result[0]?.count) || 0;
  }

  async createTimelapse(timelapse: InsertTimelapse): Promise<Timelapse> {
    const [newTimelapse] = await db.insert(timelapses).values(timelapse).returning();
    return newTimelapse;
  }

  async updateTimelapse(id: string, timelapse: Partial<Timelapse>): Promise<Timelapse | undefined> {
    const [updated] = await db.update(timelapses).set(timelapse).where(eq(timelapses.id, id)).returning();
    return updated;
  }

  async deleteTimelapse(id: string): Promise<any> {
    const result = await db.delete(timelapses).where(eq(timelapses.id, id)).returning();
    return result.length > 0 ? result[0] : null;
  }

  // Client Accounts
  async getClientAccounts(): Promise<ClientAccountWithRelations[]> {
    const result = await db.query.clientAccounts.findMany({
      with: {
        cliente: true,
        cameraAccess: {
          with: { camera: true },
        },
      },
      orderBy: desc(clientAccounts.createdAt),
    });
    return result;
  }

  async getClientAccountStatus(id: string): Promise<Pick<ClientAccount, "id" | "status"> | undefined> {
    const [result] = await db
      .select({ id: clientAccounts.id, status: clientAccounts.status })
      .from(clientAccounts)
      .where(eq(clientAccounts.id, id));
    return result;
  }

  async getClientAccount(id: string): Promise<ClientAccountWithRelations | undefined> {
    const result = await db.query.clientAccounts.findFirst({
      where: eq(clientAccounts.id, id),
      with: {
        cliente: true,
        cameraAccess: {
          with: { camera: true },
        },
      },
    });
    return result;
  }

  async getClientAccountByEmail(email: string): Promise<ClientAccount | undefined> {
    const [account] = await db.select().from(clientAccounts).where(eq(clientAccounts.email, email));
    return account;
  }

  async createClientAccount(data: { clienteId?: string | null; nome: string; email: string; senhaHash: string; status?: string }): Promise<ClientAccount> {
    const [account] = await db.insert(clientAccounts).values({
      clienteId: data.clienteId,
      nome: data.nome,
      email: data.email,
      senhaHash: data.senhaHash,
      status: data.status || "ativo",
    }).returning();
    return account;
  }

  async updateClientAccount(id: string, data: Partial<{ clienteId: string | null; nome: string; email: string; senhaHash: string; status: string }>): Promise<ClientAccount | undefined> {
    const [updated] = await db.update(clientAccounts).set(data).where(eq(clientAccounts.id, id)).returning();
    return updated;
  }

  async deleteClientAccount(id: string): Promise<boolean> {
    const result = await db.delete(clientAccounts).where(eq(clientAccounts.id, id)).returning();
    return result.length > 0;
  }

  async setClientCameraAccess(clientAccountId: string, cameraIds: string[]): Promise<void> {
    await db.delete(clientCameraAccess).where(eq(clientCameraAccess.clientAccountId, clientAccountId));
    if (cameraIds.length > 0) {
      await db.insert(clientCameraAccess).values(
        cameraIds.map((cameraId) => ({ clientAccountId, cameraId }))
      );
    }
  }

  async getClientCameraIds(clientAccountId: string): Promise<string[]> {
    const result = await db.select({ cameraId: clientCameraAccess.cameraId })
      .from(clientCameraAccess)
      .where(eq(clientCameraAccess.clientAccountId, clientAccountId));
    return result.map((r) => r.cameraId);
  }

  async updateClientPassword(id: string, senhaHash: string): Promise<void> {
    await db.update(clientAccounts)
      .set({ senhaHash, senhaAlterada: true })
      .where(eq(clientAccounts.id, id));
  }

  async incrementClientTokenVersion(id: string): Promise<void> {
    await db.update(clientAccounts)
      .set({ tokenVersion: sql`${clientAccounts.tokenVersion} + 1` })
      .where(eq(clientAccounts.id, id));
  }

  async incrementAdminTokenVersion(id: string): Promise<void> {
    await db.update(adminAccounts)
      .set({ tokenVersion: sql`${adminAccounts.tokenVersion} + 1` })
      .where(eq(adminAccounts.id, id));
  }

  async getClientAccountByResetToken(token: string): Promise<ClientAccount | undefined> {
    const [account] = await db.select().from(clientAccounts)
      .where(eq(clientAccounts.resetToken, token));
    return account;
  }

  async setResetToken(id: string, token: string, expiry: Date): Promise<void> {
    await db.update(clientAccounts)
      .set({ resetToken: token, resetTokenExpiry: expiry })
      .where(eq(clientAccounts.id, id));
  }

  async clearResetToken(id: string): Promise<void> {
    await db.update(clientAccounts)
      .set({ resetToken: null, resetTokenExpiry: null })
      .where(eq(clientAccounts.id, id));
  }

  // Admin Accounts
  async getAdminAccounts(): Promise<Omit<AdminAccount, "senhaHash">[]> {
    const result = await db.select({
      id: adminAccounts.id,
      nome: adminAccounts.nome,
      email: adminAccounts.email,
      createdAt: adminAccounts.createdAt,
    }).from(adminAccounts).orderBy(desc(adminAccounts.createdAt));
    return result;
  }

  async getAdminAccount(id: string): Promise<AdminAccount | undefined> {
    const [result] = await db.select().from(adminAccounts).where(eq(adminAccounts.id, id));
    return result;
  }

  async getAdminAccountByEmail(email: string): Promise<AdminAccount | undefined> {
    const [result] = await db.select().from(adminAccounts).where(eq(adminAccounts.email, email));
    return result;
  }

  async createAdminAccount(data: { nome: string; email: string; senhaHash: string }): Promise<AdminAccount> {
    const [account] = await db.insert(adminAccounts).values(data).returning();
    return account;
  }

  async updateAdminAccount(id: string, data: Partial<{ nome: string; email: string; senhaHash: string }>): Promise<AdminAccount | undefined> {
    const [updated] = await db.update(adminAccounts).set(data).where(eq(adminAccounts.id, id)).returning();
    return updated;
  }

  async deleteAdminAccount(id: string): Promise<boolean> {
    const result = await db.delete(adminAccounts).where(eq(adminAccounts.id, id)).returning();
    return result.length > 0;
  }

  async countAdminAccounts(): Promise<number> {
    const [result] = await db.select({ count: sql<number>`count(*)` }).from(adminAccounts);
    return Number(result.count);
  }

  // Dashboard extra
  async getDashboardExtra(): Promise<{ activityDays: { dia: string; total: number }[]; totalCaptures: number }> {
    const rows = await db.execute(sql`
      SELECT
        to_char(capturado_em AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS dia,
        count(*)::int AS total
      FROM captures
      WHERE capturado_em >= now() - interval '7 days'
      GROUP BY dia
      ORDER BY dia
    `);
    const [totalRow] = await db.select({ count: sql<number>`count(*)` }).from(captures);
    return {
      activityDays: rows.rows as { dia: string; total: number }[],
      totalCaptures: Number(totalRow?.count) || 0,
    };
  }

  // Stats
  async getStats(): Promise<{
    totalClients: number;
    activeClients: number;
    totalCameras: number;
    onlineCameras: number;
    offlineCameras: number;
    todayCaptures: number;
    processingTimelapses: number;
  }> {
    const [clientStats] = await db.select({ 
      total: sql<number>`count(*)`,
      active: sql<number>`count(*) filter (where status = 'ativo')`
    }).from(clients);

    const [cameraStats] = await db.select({ 
      total: sql<number>`count(*)`,
      online: sql<number>`count(*) filter (where status = 'online')`,
      offline: sql<number>`count(*) filter (where status = 'offline')`
    }).from(cameras);

    const todayCaptures = await this.getTodayCapturesCount();
    const processingTimelapses = await this.getProcessingTimelapsesCount();

    return {
      totalClients: Number(clientStats?.total) || 0,
      activeClients: Number(clientStats?.active) || 0,
      totalCameras: Number(cameraStats?.total) || 0,
      onlineCameras: Number(cameraStats?.online) || 0,
      offlineCameras: Number(cameraStats?.offline) || 0,
      todayCaptures,
      processingTimelapses,
    };
  }
}

export const storage = new DatabaseStorage();
