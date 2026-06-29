// PostgresClientReadModel — the read-only backing for the bridge's search_clients tool.
//
// READ-ONLY by construction: the ONLY statement here is a parameterized SELECT. There is no INSERT/
// UPDATE/DELETE anywhere in this file, and the role it runs as (ece_app) has SELECT-only privilege on
// `clients` (migration 0007) — so read-only is enforced both in the code and at the database layer.

import type { Pool } from 'pg';
import type { ClientReadModel, SearchClientsInput, ClientRecord } from './mcp-bridge.js';

export class PostgresClientReadModel implements ClientReadModel {
  constructor(private readonly pool: Pool) {}

  async searchClients(input: SearchClientsInput): Promise<ClientRecord[]> {
    // Parameterized read; case-insensitive name match scoped to the caller's organization.
    const r = await this.pool.query<ClientRecord>(
      `SELECT client_id, organization_id, name, email, ssn, notes
         FROM clients
        WHERE organization_id = $1 AND name ILIKE '%' || $2 || '%'
        ORDER BY name`,
      [input.organizationId, input.q],
    );
    return r.rows;
  }
}
