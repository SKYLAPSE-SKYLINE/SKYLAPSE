/**
 * Audit logger — structured JSON to stdout.
 * Render captures all stdout, so these entries appear in the log dashboard
 * and can be filtered/searched. Each line is valid JSON for log aggregation tools.
 */

type AuditAction =
  | "admin.login.success"
  | "admin.login.failure"
  | "admin.logout"
  | "admin.account.created"
  | "admin.account.deleted"
  | "admin.password.changed"
  | "client.login.success"
  | "client.login.failure"
  | "client.logout"
  | "client.password.changed"
  | "client.password.reset"
  | "client.account.created"
  | "client.account.deleted"
  | "camera.deleted"
  | "camera.created"
  | "capture.deleted"
  | "timelapse.deleted"
  | "support.ticket.created"
  | "support.ticket.updated";

export function audit(action: AuditAction, meta: Record<string, string | number | boolean | null | undefined> = {}) {
  const entry = {
    ts: new Date().toISOString(),
    audit: true,
    action,
    ...meta,
  };
  console.log(JSON.stringify(entry));
}
