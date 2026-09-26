ALTER TABLE llm_agent_routes
  ADD COLUMN owner_user_id TEXT REFERENCES app_users(id) ON DELETE CASCADE;

UPDATE llm_agent_routes
SET owner_user_id=created_by
WHERE scope_type='case'
  AND created_by IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM llm_provider_connections c
    WHERE c.id=llm_agent_routes.connection_id
      AND c.scope_type='teacher'
      AND c.owner_user_id=llm_agent_routes.created_by
  );

DROP INDEX llm_agent_routes_scope_agent_uidx;

CREATE UNIQUE INDEX llm_agent_routes_global_scope_agent_uidx
  ON llm_agent_routes(scope_type,ifnull(scope_id,''),agent_type)
  WHERE owner_user_id IS NULL;

CREATE UNIQUE INDEX llm_agent_routes_owner_scope_agent_uidx
  ON llm_agent_routes(scope_type,scope_id,owner_user_id,agent_type)
  WHERE owner_user_id IS NOT NULL;

CREATE INDEX llm_agent_routes_owner_idx
  ON llm_agent_routes(owner_user_id,updated_at DESC);
