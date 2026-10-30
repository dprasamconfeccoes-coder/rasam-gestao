-- Supporting indexes for foreign-key lookups and cascade checks in work-order management.
CREATE INDEX IF NOT EXISTS idx_ordens_servico_cliente_fk
  ON public.ordens_servico (cliente_id);

CREATE INDEX IF NOT EXISTS idx_ordens_servico_created_by_fk
  ON public.ordens_servico (created_by);

CREATE INDEX IF NOT EXISTS idx_ordens_auditoria_ordem_fk
  ON public.ordens_servico_auditoria (ordem_id);

CREATE INDEX IF NOT EXISTS idx_ordens_auditoria_usuario_fk
  ON public.ordens_servico_auditoria (usuario_id);
