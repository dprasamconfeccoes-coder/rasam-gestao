BEGIN;

ALTER TABLE public.ordens_servico_auditoria
  DROP CONSTRAINT IF EXISTS ordens_servico_auditoria_evento_check;

ALTER TABLE public.ordens_servico_auditoria
  ADD CONSTRAINT ordens_servico_auditoria_evento_check
  CHECK (evento IN (
    'ordem_criada',
    'ordem_campos_comerciais_incluidos',
    'status_alterado',
    'financeiro_nf_atualizado',
    'progresso_atualizado',
    'financeiro_liberado',
    'documento_adicionado'
  ));

COMMIT;
