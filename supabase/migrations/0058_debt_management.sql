BEGIN;

-- Cabeçalho do passivo: mantém os registros legados e acrescenta categoria/origem.
ALTER TABLE public.dividas_gestao
  ADD COLUMN IF NOT EXISTS categoria text,
  ADD COLUMN IF NOT EXISTS data_contratacao date,
  ADD COLUMN IF NOT EXISTS revisao_pendente boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS origem_legada text,
  ADD COLUMN IF NOT EXISTS modelo_agenda text NOT NULL DEFAULT 'legado',
  ADD COLUMN IF NOT EXISTS parcelamento_origem_id uuid REFERENCES public.financeiro_parcelamentos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS inativada_em timestamptz;

UPDATE public.dividas_gestao
SET categoria = 'outros', revisao_pendente = true
WHERE categoria IS NULL;

ALTER TABLE public.dividas_gestao ALTER COLUMN categoria SET DEFAULT 'outros';
ALTER TABLE public.dividas_gestao ALTER COLUMN categoria SET NOT NULL;
ALTER TABLE public.dividas_gestao DROP CONSTRAINT IF EXISTS dividas_gestao_status_check;
ALTER TABLE public.dividas_gestao
  ADD CONSTRAINT dividas_gestao_status_check
  CHECK (status IN ('ativa','quitada','renegociada','inativa'));
ALTER TABLE public.dividas_gestao DROP CONSTRAINT IF EXISTS dividas_gestao_categoria_check;
ALTER TABLE public.dividas_gestao
  ADD CONSTRAINT dividas_gestao_categoria_check
  CHECK (categoria IN ('trabalhista','previdenciaria','emprestimo_pessoal','consignado','outros'));
ALTER TABLE public.dividas_gestao DROP CONSTRAINT IF EXISTS dividas_gestao_modelo_agenda_check;
ALTER TABLE public.dividas_gestao
  ADD CONSTRAINT dividas_gestao_modelo_agenda_check
  CHECK (modelo_agenda IN ('legado','migrado','novo'));
CREATE UNIQUE INDEX IF NOT EXISTS uq_dividas_gestao_parcelamento_origem
  ON public.dividas_gestao(parcelamento_origem_id) WHERE parcelamento_origem_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dividas_gestao_empresa_status_vencimento
  ON public.dividas_gestao(empresa_id,status,vencimento);

CREATE TABLE IF NOT EXISTS public.dividas_parcelas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id),
  divida_id uuid NOT NULL REFERENCES public.dividas_gestao(id),
  tipo_item text NOT NULL DEFAULT 'parcela' CHECK (tipo_item IN ('entrada','parcela','saldo_legado')),
  numero integer NOT NULL,
  valor numeric(14,2) NOT NULL CHECK (valor >= 0),
  vencimento date,
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','paga')),
  ativo boolean NOT NULL DEFAULT true,
  pago_em date,
  forma_pagamento text NOT NULL DEFAULT 'outro' CHECK (forma_pagamento IN ('pix','transferencia','boleto','outro')),
  chave_pix text,
  dados_transferencia text,
  source_finance_parcela_id uuid REFERENCES public.financeiro_parcelas(id) ON DELETE SET NULL,
  legacy_comprovante_ref text,
  legacy_comprovante_nome text,
  created_by uuid REFERENCES public.usuarios(id),
  updated_by uuid REFERENCES public.usuarios(id),
  pago_por uuid REFERENCES public.usuarios(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dividas_parcelas_tipo_numero_check CHECK (
    (tipo_item = 'entrada' AND numero = 0) OR
    (tipo_item = 'saldo_legado' AND numero = 0) OR
    (tipo_item = 'parcela' AND numero > 0)
  ),
  CONSTRAINT dividas_parcelas_vencimento_check CHECK (tipo_item IN ('entrada','saldo_legado') OR vencimento IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_dividas_parcelas_item
  ON public.dividas_parcelas(divida_id,tipo_item,numero);
CREATE UNIQUE INDEX IF NOT EXISTS uq_dividas_parcelas_origem_financeira
  ON public.dividas_parcelas(source_finance_parcela_id) WHERE source_finance_parcela_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dividas_parcelas_empresa_vencimento
  ON public.dividas_parcelas(empresa_id,ativo,status,vencimento);
CREATE INDEX IF NOT EXISTS idx_dividas_parcelas_divida
  ON public.dividas_parcelas(divida_id,numero);

CREATE TABLE IF NOT EXISTS public.dividas_arquivos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id),
  divida_id uuid NOT NULL REFERENCES public.dividas_gestao(id),
  parcela_id uuid NOT NULL REFERENCES public.dividas_parcelas(id),
  tipo text NOT NULL CHECK (tipo IN ('documento_pagamento','comprovante')),
  storage_path text NOT NULL,
  arquivo_nome text NOT NULL,
  mime_type text NOT NULL,
  tamanho_bytes bigint NOT NULL CHECK (tamanho_bytes > 0),
  uploaded_by uuid REFERENCES public.usuarios(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dividas_arquivos_parcela
  ON public.dividas_arquivos(empresa_id,parcela_id,tipo,created_at DESC);

CREATE TABLE IF NOT EXISTS public.dividas_auditoria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id),
  divida_id uuid NOT NULL REFERENCES public.dividas_gestao(id),
  parcela_id uuid REFERENCES public.dividas_parcelas(id),
  usuario_id uuid REFERENCES public.usuarios(id),
  evento text NOT NULL,
  detalhes jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dividas_auditoria_divida
  ON public.dividas_auditoria(empresa_id,divida_id,created_at DESC);

ALTER TABLE public.dividas_parcelas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dividas_arquivos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dividas_auditoria ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dividas_parcelas, public.dividas_arquivos, public.dividas_auditoria FROM PUBLIC, anon, authenticated;

-- A interface histórica guardava somente um saldo, sem agenda de parcelas.
-- Representamos o saldo atual como item legado para não inventar vencimentos ou condições.
INSERT INTO public.dividas_parcelas(empresa_id,divida_id,tipo_item,numero,valor,vencimento,status,ativo,created_by,created_at,updated_at)
SELECT d.empresa_id,d.id,'saldo_legado',0,d.saldo_devedor,d.vencimento,'pendente',true,d.created_by,coalesce(d.created_at,now()),coalesce(d.updated_at,now())
FROM public.dividas_gestao d
WHERE d.saldo_devedor > 0
  AND d.status <> 'quitada'
  AND d.parcelamento_origem_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM public.dividas_parcelas p WHERE p.divida_id=d.id LIMIT 1);

-- Preserva parcelamentos financeiros existentes no módulo novo e os vincula à origem.
-- A categoria fica em "outros" e marcada para revisão: a origem não prova a natureza da dívida.
INSERT INTO public.dividas_gestao(
  empresa_id,parcelamento_origem_id,credor,descricao,valor_original,saldo_devedor,vencimento,status,
  observacoes,created_by,created_at,updated_at,categoria,data_contratacao,revisao_pendente,origem_legada,modelo_agenda
)
SELECT s.empresa_id,s.id,s.credor,s.descricao,
  round(coalesce(s.valor_entrada,0)+coalesce((SELECT sum(fp.valor) FROM public.financeiro_parcelas fp WHERE fp.parcelamento_id=s.id),s.valor_padrao*s.quantidade_parcelas),2),
  round(coalesce(s.valor_entrada,0)+coalesce((SELECT sum(fp.valor) FROM public.financeiro_parcelas fp WHERE fp.parcelamento_id=s.id AND fp.status NOT IN ('pago','cancelado')),s.valor_padrao*s.quantidade_parcelas),2),
  s.data_primeiro_vencimento,
  CASE
    WHEN coalesce(s.valor_entrada,0)=0
      AND EXISTS (SELECT 1 FROM public.financeiro_parcelas fp WHERE fp.parcelamento_id=s.id LIMIT 1)
      AND NOT EXISTS (SELECT 1 FROM public.financeiro_parcelas fp WHERE fp.parcelamento_id=s.id AND fp.status <> 'pago' LIMIT 1)
      THEN 'quitada'
    WHEN EXISTS (SELECT 1 FROM public.financeiro_parcelas fp WHERE fp.parcelamento_id=s.id AND fp.status='cancelado' LIMIT 1)
      AND NOT EXISTS (SELECT 1 FROM public.financeiro_parcelas fp WHERE fp.parcelamento_id=s.id AND fp.status NOT IN ('pago','cancelado') LIMIT 1)
      THEN 'inativa'
    ELSE 'ativa'
  END,
  concat_ws(E'\n',nullif(trim(s.fonte_documento),''), 'Migrado do módulo Financeiro; revise a categoria, a entrada e as condições do plano.'),
  s.created_by,s.created_at,s.created_at,'outros',NULL,true,s.tipo,'migrado'
FROM public.financeiro_parcelamentos s
WHERE NOT EXISTS (SELECT 1 FROM public.dividas_gestao d WHERE d.parcelamento_origem_id=s.id LIMIT 1);

INSERT INTO public.dividas_parcelas(
  empresa_id,divida_id,tipo_item,numero,valor,vencimento,status,ativo,pago_em,forma_pagamento,
  source_finance_parcela_id,legacy_comprovante_ref,legacy_comprovante_nome,created_by,pago_por,created_at,updated_at
)
SELECT fp.empresa_id,d.id,'parcela',fp.numero,fp.valor,fp.vencimento,
  CASE WHEN fp.status='pago' THEN 'paga' ELSE 'pendente' END,
  fp.status <> 'cancelado',fp.pago_em,'outro',fp.id,fp.comprovante_url,fp.comprovante_nome,
  fp.baixado_por,fp.baixado_por,coalesce(d.created_at,now()),coalesce(d.updated_at,now())
FROM public.financeiro_parcelas fp
JOIN public.dividas_gestao d ON d.parcelamento_origem_id=fp.parcelamento_id
WHERE NOT EXISTS (SELECT 1 FROM public.dividas_parcelas p WHERE p.source_finance_parcela_id=fp.id LIMIT 1);

INSERT INTO public.dividas_parcelas(
  empresa_id,divida_id,tipo_item,numero,valor,vencimento,status,ativo,forma_pagamento,created_by,created_at,updated_at
)
SELECT s.empresa_id,d.id,'entrada',0,s.valor_entrada,NULL,'pendente',true,'outro',s.created_by,s.created_at,s.created_at
FROM public.financeiro_parcelamentos s
JOIN public.dividas_gestao d ON d.parcelamento_origem_id=s.id
WHERE s.valor_entrada > 0
  AND NOT EXISTS (SELECT 1 FROM public.dividas_parcelas p WHERE p.divida_id=d.id AND p.tipo_item='entrada' LIMIT 1);

-- Preserva comprovantes legados que apontam para um caminho privado do Storage.
INSERT INTO public.dividas_arquivos(empresa_id,divida_id,parcela_id,tipo,storage_path,arquivo_nome,mime_type,tamanho_bytes,uploaded_by,created_at)
SELECT dp.empresa_id,dp.divida_id,dp.id,'comprovante',fp.comprovante_url,
  coalesce(nullif(fp.comprovante_nome,''),'Comprovante legado'),'application/octet-stream',1,
  fp.baixado_por,coalesce(fp.pago_em::timestamptz,now())
FROM public.financeiro_parcelas fp
JOIN public.dividas_parcelas dp ON dp.source_finance_parcela_id=fp.id
WHERE nullif(trim(fp.comprovante_url),'') IS NOT NULL
  AND position('://' in fp.comprovante_url)=0
  AND NOT EXISTS (SELECT 1 FROM public.dividas_arquivos a WHERE a.parcela_id=dp.id AND a.storage_path=fp.comprovante_url LIMIT 1);

INSERT INTO public.dividas_auditoria(empresa_id,divida_id,usuario_id,evento,detalhes,created_at)
SELECT d.empresa_id,d.id,d.created_by,'divida_migrada',
  jsonb_build_object('origem',coalesce(d.origem_legada,'dividas_gestao'),'modelo_agenda',d.modelo_agenda,'status',d.status),
  coalesce(d.created_at,now())
FROM public.dividas_gestao d
WHERE NOT EXISTS (
  SELECT 1 FROM public.dividas_auditoria a
  WHERE a.divida_id=d.id AND a.evento='divida_migrada'
  LIMIT 1
);

CREATE OR REPLACE FUNCTION public.app_dividas_admin_allowed(p_token text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','extensions'
AS $function$
DECLARE v_profile text; v_role text;
BEGIN
  IF p_token IS NULL OR btrim(p_token)='' THEN RETURN false; END IF;
  SELECT lower(coalesce(u.perfil,'')),public.app_role_code_for_user(u.id)
    INTO v_profile,v_role
  FROM public.sessoes s JOIN public.usuarios u ON u.id=s.usuario_id
  WHERE s.token=p_token AND s.expira_em>now() AND u.ativo IS TRUE
  LIMIT 1;
  IF NOT FOUND THEN RETURN false; END IF;
  RETURN v_profile IN ('admin','administrador') OR v_role='administrador_sistema';
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_dividas_admin_context(p_token text)
RETURNS TABLE(usuario_id uuid,empresa_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','extensions'
AS $function$
DECLARE v_tenant record;
BEGIN
  IF NOT public.app_dividas_admin_allowed(p_token) THEN
    RAISE EXCEPTION 'Acesso restrito a administradores' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_tenant FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v_tenant.usuario_id IS NULL OR v_tenant.empresa_id IS NULL THEN
    RAISE EXCEPTION 'Sessão inválida' USING ERRCODE='28000';
  END IF;
  RETURN QUERY SELECT v_tenant.usuario_id,v_tenant.empresa_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_dividas_recalcular(p_divida_id uuid,p_empresa_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','extensions'
AS $function$
DECLARE v_total numeric(14,2); v_saldo numeric(14,2); v_proximo date; v_qtd integer; v_qtd_inativos integer; v_status text; v_modelo text;
BEGIN
  SELECT d.status,d.modelo_agenda INTO v_status,v_modelo
  FROM public.dividas_gestao d WHERE d.id=p_divida_id AND d.empresa_id=p_empresa_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT count(*),round(coalesce(sum(p.valor),0),2),
    round(coalesce(sum(p.valor) FILTER (WHERE p.status='pendente' AND p.ativo IS TRUE),0),2),
    count(*) FILTER (WHERE p.status='pendente' AND p.ativo IS NOT TRUE),
    min(p.vencimento) FILTER (WHERE p.status='pendente' AND p.ativo IS TRUE)
  INTO v_qtd,v_total,v_saldo,v_qtd_inativos,v_proximo
  FROM public.dividas_parcelas p WHERE p.divida_id=p_divida_id AND p.empresa_id=p_empresa_id;
  UPDATE public.dividas_gestao d
  SET valor_original=CASE WHEN v_modelo IN ('novo','migrado') AND v_qtd>0 THEN v_total ELSE d.valor_original END,
      saldo_devedor=CASE WHEN v_qtd>0 THEN v_saldo ELSE d.saldo_devedor END,
      vencimento=CASE WHEN v_qtd>0 THEN v_proximo ELSE d.vencimento END,
      status=CASE WHEN d.status='inativa' THEN 'inativa' WHEN v_qtd>0 AND v_saldo=0 AND v_qtd_inativos=0 THEN 'quitada' WHEN v_qtd>0 THEN 'ativa' ELSE d.status END,
      inativada_em=CASE WHEN d.status='inativa' THEN coalesce(d.inativada_em,now()) ELSE NULL END,
      updated_at=now()
  WHERE d.id=p_divida_id AND d.empresa_id=p_empresa_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_admin_dividas_dashboard(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','extensions'
AS $function$
DECLARE v record; v_dividas jsonb;
BEGIN
  SELECT * INTO v FROM public.app_dividas_admin_context(p_token) LIMIT 1;
  SELECT coalesce(jsonb_agg(q.item ORDER BY q.updated_at DESC),'[]'::jsonb) INTO v_dividas
  FROM (
    SELECT d.updated_at,
      (to_jsonb(d)-'empresa_id'-'created_by'-'updated_by'-'parcelamento_origem_id') || jsonb_build_object(
        'parcelas',coalesce((
          SELECT jsonb_agg(to_jsonb(x) ORDER BY x.numero,x.created_at)
          FROM (
            SELECT p.id,p.tipo_item,p.numero,p.valor,p.vencimento,p.status,p.ativo,p.pago_em,p.forma_pagamento,
              p.chave_pix,p.dados_transferencia,p.legacy_comprovante_nome,p.created_at,p.updated_at,
              coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'tipo',a.tipo,'arquivo_nome',a.arquivo_nome,'mime_type',a.mime_type,'tamanho_bytes',a.tamanho_bytes,'created_at',a.created_at) ORDER BY a.created_at DESC)
                FROM public.dividas_arquivos a WHERE a.empresa_id=v.empresa_id AND a.parcela_id=p.id),'[]'::jsonb) AS arquivos
            FROM public.dividas_parcelas p
            WHERE p.empresa_id=v.empresa_id AND p.divida_id=d.id
          ) x
        ),'[]'::jsonb),
        'auditoria',coalesce((
          SELECT jsonb_agg(to_jsonb(h) ORDER BY h.created_at DESC)
          FROM (
            SELECT a.id,a.evento,a.detalhes,coalesce(u.nome_exibicao,'Administrador') AS usuario_nome,a.created_at
            FROM public.dividas_auditoria a
            LEFT JOIN public.usuarios u ON u.id=a.usuario_id
            WHERE a.empresa_id=v.empresa_id AND a.divida_id=d.id
            ORDER BY a.created_at DESC
            LIMIT 100
          ) h
        ),'[]'::jsonb)
      ) AS item
    FROM public.dividas_gestao d
    WHERE d.empresa_id=v.empresa_id
    ORDER BY d.updated_at DESC
    LIMIT 500
  ) q;
  RETURN jsonb_build_object('sucesso',true,'dividas',v_dividas);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('sucesso',false,'erro','Não foi possível consultar a gestão de dívidas.');
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_admin_divida_criar(p_token text,p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','extensions'
AS $function$
DECLARE v record; v_credor text; v_descricao text; v_categoria text; v_obs text; v_data date; v_total numeric; v_entrada numeric; v_entrada_venc date; v_metodo text; v_chave text; v_banco text; v_item jsonb; v_valor numeric; v_venc date; v_sum numeric:=0; v_num integer:=0; v_id uuid; v_pid uuid;
BEGIN
  SELECT * INTO v FROM public.app_dividas_admin_context(p_token) LIMIT 1;
  v_credor:=trim(coalesce(p_payload->>'credor',''));
  v_descricao:=trim(coalesce(p_payload->>'descricao',''));
  v_categoria:=coalesce(p_payload->>'categoria','');
  v_obs:=nullif(trim(coalesce(p_payload->>'observacoes','')),'');
  v_data:=nullif(p_payload->>'data_contratacao','')::date;
  v_total:=round(coalesce(nullif(p_payload->>'valor_total','')::numeric,0),2);
  v_entrada:=round(coalesce(nullif(p_payload #>> '{entrada,valor}','')::numeric,0),2);
  v_entrada_venc:=nullif(p_payload #>> '{entrada,vencimento}','')::date;
  v_metodo:=coalesce(p_payload #>> '{entrada,forma_pagamento}',p_payload #>> '{forma_pagamento}','outro');
  v_chave:=nullif(trim(coalesce(p_payload #>> '{entrada,chave_pix}',p_payload->>'chave_pix','')),'');
  v_banco:=nullif(trim(coalesce(p_payload #>> '{entrada,dados_transferencia}',p_payload->>'dados_transferencia','')),'');
  IF v_credor='' OR length(v_credor)>180 OR v_descricao='' OR length(v_descricao)>500 OR v_categoria NOT IN ('trabalhista','previdenciaria','emprestimo_pessoal','consignado','outros') THEN
    RETURN jsonb_build_object('sucesso',false,'erro','Informe credor, descrição e categoria válidos.');
  END IF;
  IF v_total<=0 OR v_entrada<0 OR v_entrada>v_total OR v_metodo NOT IN ('pix','transferencia','boleto','outro') THEN
    RETURN jsonb_build_object('sucesso',false,'erro','Confira o valor total, a entrada e a forma de pagamento.');
  END IF;
  IF v_metodo='pix' AND v_chave IS NULL THEN RETURN jsonb_build_object('sucesso',false,'erro','Informe a chave Pix.'); END IF;
  IF v_metodo='transferencia' AND v_banco IS NULL THEN RETURN jsonb_build_object('sucesso',false,'erro','Informe os dados bancários para transferência.'); END IF;
  IF jsonb_typeof(p_payload->'parcelas')<>'array' OR jsonb_array_length(p_payload->'parcelas')<1 OR jsonb_array_length(p_payload->'parcelas')>240 THEN
    RETURN jsonb_build_object('sucesso',false,'erro','Informe de 1 a 240 parcelas.');
  END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_payload->'parcelas') LOOP
    v_num:=v_num+1; v_valor:=round(coalesce(nullif(v_item->>'valor','')::numeric,0),2); v_venc:=nullif(v_item->>'vencimento','')::date;
    IF v_valor<=0 OR v_venc IS NULL THEN RETURN jsonb_build_object('sucesso',false,'erro','Cada parcela deve ter valor positivo e vencimento.'); END IF;
    v_sum:=v_sum+v_valor;
  END LOOP;
  IF abs(round(v_sum+v_entrada,2)-v_total)>0.01 THEN RETURN jsonb_build_object('sucesso',false,'erro','A entrada somada às parcelas deve fechar o valor total contratado.'); END IF;
  INSERT INTO public.dividas_gestao(empresa_id,credor,descricao,valor_original,saldo_devedor,vencimento,status,observacoes,created_by,categoria,data_contratacao,revisao_pendente,modelo_agenda)
  VALUES(v.empresa_id,v_credor,v_descricao,v_total,v_total,(SELECT min((x->>'vencimento')::date) FROM jsonb_array_elements(p_payload->'parcelas') x),'ativa',v_obs,v.usuario_id,v_categoria,v_data,false,'novo')
  RETURNING id INTO v_id;
  IF v_entrada>0 THEN
    INSERT INTO public.dividas_parcelas(empresa_id,divida_id,tipo_item,numero,valor,vencimento,status,forma_pagamento,chave_pix,dados_transferencia,created_by)
    VALUES(v.empresa_id,v_id,'entrada',0,v_entrada,v_entrada_venc,'pendente',v_metodo,v_chave,v_banco,v.usuario_id);
  END IF;
  v_num:=0;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_payload->'parcelas') LOOP
    v_num:=v_num+1; v_valor:=round((v_item->>'valor')::numeric,2); v_venc:=(v_item->>'vencimento')::date;
    INSERT INTO public.dividas_parcelas(empresa_id,divida_id,tipo_item,numero,valor,vencimento,status,forma_pagamento,chave_pix,dados_transferencia,created_by)
    VALUES(v.empresa_id,v_id,'parcela',v_num,v_valor,v_venc,'pendente',v_metodo,v_chave,v_banco,v.usuario_id);
  END LOOP;
  INSERT INTO public.dividas_auditoria(empresa_id,divida_id,usuario_id,evento,detalhes)
  VALUES(v.empresa_id,v_id,v.usuario_id,'divida_criada',jsonb_build_object('valor_total',v_total,'categoria',v_categoria,'quantidade_parcelas',v_num,'valor_entrada',v_entrada));
  RETURN jsonb_build_object('sucesso',true,'id',v_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('sucesso',false,'erro','Não foi possível cadastrar a dívida. Confira os valores e as datas.');
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_admin_divida_atualizar(p_token text,p_divida_id uuid,p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','extensions'
AS $function$
DECLARE v record; d record; v_credor text; v_descricao text; v_categoria text; v_data date; v_obs text;
BEGIN
  SELECT * INTO v FROM public.app_dividas_admin_context(p_token) LIMIT 1;
  SELECT * INTO d FROM public.dividas_gestao WHERE id=p_divida_id AND empresa_id=v.empresa_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('sucesso',false,'erro','Dívida não encontrada.'); END IF;
  IF d.status='inativa' THEN RETURN jsonb_build_object('sucesso',false,'erro','Restaure a dívida antes de editar seus dados.'); END IF;
  v_credor:=trim(coalesce(p_payload->>'credor','')); v_descricao:=trim(coalesce(p_payload->>'descricao','')); v_categoria:=coalesce(p_payload->>'categoria','');
  v_data:=nullif(p_payload->>'data_contratacao','')::date; v_obs:=nullif(trim(coalesce(p_payload->>'observacoes','')),'');
  IF v_credor='' OR length(v_credor)>180 OR v_descricao='' OR length(v_descricao)>500 OR v_categoria NOT IN ('trabalhista','previdenciaria','emprestimo_pessoal','consignado','outros') THEN
    RETURN jsonb_build_object('sucesso',false,'erro','Confira credor, descrição e categoria.');
  END IF;
  UPDATE public.dividas_gestao SET credor=v_credor,descricao=v_descricao,categoria=v_categoria,data_contratacao=v_data,observacoes=v_obs,revisao_pendente=false,updated_at=now()
  WHERE id=p_divida_id AND empresa_id=v.empresa_id;
  INSERT INTO public.dividas_auditoria(empresa_id,divida_id,usuario_id,evento,detalhes)
  VALUES(v.empresa_id,p_divida_id,v.usuario_id,'dados_divida_atualizados',jsonb_build_object('categoria',v_categoria,'credor',v_credor));
  RETURN jsonb_build_object('sucesso',true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('sucesso',false,'erro','Não foi possível atualizar a dívida.');
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_admin_divida_parcela_adicionar(p_token text,p_divida_id uuid,p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','extensions'
AS $function$
DECLARE v record; d record; v_num integer; v_valor numeric; v_venc date; v_metodo text; v_chave text; v_banco text; v_id uuid;
BEGIN
  SELECT * INTO v FROM public.app_dividas_admin_context(p_token) LIMIT 1;
  SELECT * INTO d FROM public.dividas_gestao WHERE id=p_divida_id AND empresa_id=v.empresa_id FOR UPDATE;
  IF NOT FOUND OR d.status='inativa' THEN RETURN jsonb_build_object('sucesso',false,'erro','Dívida não encontrada ou inativa.'); END IF;
  IF d.modelo_agenda='legado' THEN RETURN jsonb_build_object('sucesso',false,'erro','Este saldo legado precisa ser revisado antes de criar novas parcelas.'); END IF;
  v_valor:=round(coalesce(nullif(p_payload->>'valor','')::numeric,0),2); v_venc:=nullif(p_payload->>'vencimento','')::date;
  v_metodo:=coalesce(p_payload->>'forma_pagamento','outro'); v_chave:=nullif(trim(coalesce(p_payload->>'chave_pix','')),''); v_banco:=nullif(trim(coalesce(p_payload->>'dados_transferencia','')),'');
  IF v_valor<=0 OR v_venc IS NULL OR v_metodo NOT IN ('pix','transferencia','boleto','outro') THEN RETURN jsonb_build_object('sucesso',false,'erro','Informe valor, vencimento e forma de pagamento válidos.'); END IF;
  IF v_metodo='pix' AND v_chave IS NULL THEN RETURN jsonb_build_object('sucesso',false,'erro','Informe a chave Pix.'); END IF;
  IF v_metodo='transferencia' AND v_banco IS NULL THEN RETURN jsonb_build_object('sucesso',false,'erro','Informe os dados bancários.'); END IF;
  SELECT coalesce(max(numero),0)+1 INTO v_num FROM public.dividas_parcelas WHERE divida_id=p_divida_id AND tipo_item='parcela';
  IF v_num>240 THEN RETURN jsonb_build_object('sucesso',false,'erro','O plano não pode ultrapassar 240 parcelas.'); END IF;
  INSERT INTO public.dividas_parcelas(empresa_id,divida_id,tipo_item,numero,valor,vencimento,status,forma_pagamento,chave_pix,dados_transferencia,created_by)
  VALUES(v.empresa_id,p_divida_id,'parcela',v_num,v_valor,v_venc,'pendente',v_metodo,v_chave,v_banco,v.usuario_id) RETURNING id INTO v_id;
  PERFORM public.app_dividas_recalcular(p_divida_id,v.empresa_id);
  INSERT INTO public.dividas_auditoria(empresa_id,divida_id,parcela_id,usuario_id,evento,detalhes)
  VALUES(v.empresa_id,p_divida_id,v_id,v.usuario_id,'parcela_adicionada',jsonb_build_object('valor',v_valor,'vencimento',v_venc));
  RETURN jsonb_build_object('sucesso',true,'id',v_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('sucesso',false,'erro','Não foi possível adicionar a parcela.');
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_admin_divida_parcela_atualizar(p_token text,p_parcela_id uuid,p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','extensions'
AS $function$
DECLARE v record; p record; v_valor numeric; v_venc date; v_metodo text; v_chave text; v_banco text;
BEGIN
  SELECT * INTO v FROM public.app_dividas_admin_context(p_token) LIMIT 1;
  SELECT dp.*,d.status AS divida_status INTO p
  FROM public.dividas_parcelas dp JOIN public.dividas_gestao d ON d.id=dp.divida_id AND d.empresa_id=dp.empresa_id
  WHERE dp.id=p_parcela_id AND dp.empresa_id=v.empresa_id FOR UPDATE OF dp;
  IF NOT FOUND OR p.divida_status='inativa' THEN RETURN jsonb_build_object('sucesso',false,'erro','Parcela não encontrada ou dívida inativa.'); END IF;
  IF p.status='paga' OR p.ativo IS NOT TRUE THEN RETURN jsonb_build_object('sucesso',false,'erro','Somente parcelas pendentes e ativas podem ser editadas.'); END IF;
  v_valor:=round(coalesce(nullif(p_payload->>'valor','')::numeric,0),2); v_venc:=nullif(p_payload->>'vencimento','')::date;
  v_metodo:=coalesce(p_payload->>'forma_pagamento','outro'); v_chave:=nullif(trim(coalesce(p_payload->>'chave_pix','')),''); v_banco:=nullif(trim(coalesce(p_payload->>'dados_transferencia','')),'');
  IF v_valor<=0 OR (p.tipo_item NOT IN ('entrada','saldo_legado') AND v_venc IS NULL) OR v_metodo NOT IN ('pix','transferencia','boleto','outro') THEN RETURN jsonb_build_object('sucesso',false,'erro','Confira valor, vencimento e forma de pagamento.'); END IF;
  IF v_metodo='pix' AND v_chave IS NULL THEN RETURN jsonb_build_object('sucesso',false,'erro','Informe a chave Pix.'); END IF;
  IF v_metodo='transferencia' AND v_banco IS NULL THEN RETURN jsonb_build_object('sucesso',false,'erro','Informe os dados bancários.'); END IF;
  UPDATE public.dividas_parcelas SET valor=v_valor,vencimento=v_venc,forma_pagamento=v_metodo,chave_pix=v_chave,dados_transferencia=v_banco,updated_by=v.usuario_id,updated_at=now()
  WHERE id=p_parcela_id AND empresa_id=v.empresa_id;
  PERFORM public.app_dividas_recalcular(p.divida_id,v.empresa_id);
  INSERT INTO public.dividas_auditoria(empresa_id,divida_id,parcela_id,usuario_id,evento,detalhes)
  VALUES(v.empresa_id,p.divida_id,p_parcela_id,v.usuario_id,'parcela_atualizada',jsonb_build_object('valor',v_valor,'vencimento',v_venc,'forma_pagamento',v_metodo));
  RETURN jsonb_build_object('sucesso',true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('sucesso',false,'erro','Não foi possível atualizar a parcela.');
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_admin_divida_parcela_status(p_token text,p_parcela_id uuid,p_acao text,p_motivo text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','extensions'
AS $function$
DECLARE v record; p record; v_ativo boolean; v_status text;
BEGIN
  SELECT * INTO v FROM public.app_dividas_admin_context(p_token) LIMIT 1;
  SELECT dp.*,d.status AS divida_status INTO p
  FROM public.dividas_parcelas dp JOIN public.dividas_gestao d ON d.id=dp.divida_id AND d.empresa_id=dp.empresa_id
  WHERE dp.id=p_parcela_id AND dp.empresa_id=v.empresa_id FOR UPDATE OF dp;
  IF NOT FOUND OR p.divida_status='inativa' THEN RETURN jsonb_build_object('sucesso',false,'erro','Parcela não encontrada ou dívida inativa.'); END IF;
  IF p_acao NOT IN ('inativar','restaurar','reabrir') THEN RETURN jsonb_build_object('sucesso',false,'erro','Ação inválida.'); END IF;
  IF p_acao='inativar' THEN
    IF p.status<>'pendente' OR p.ativo IS NOT TRUE THEN RETURN jsonb_build_object('sucesso',false,'erro','Somente parcelas pendentes e ativas podem ser inativadas.'); END IF;
    IF length(trim(coalesce(p_motivo,'')))<3 THEN RETURN jsonb_build_object('sucesso',false,'erro','Informe o motivo da inativação.'); END IF;
    v_ativo:=false; v_status:='pendente';
  ELSIF p_acao='restaurar' THEN
    IF p.status<>'pendente' OR p.ativo IS TRUE THEN RETURN jsonb_build_object('sucesso',false,'erro','Esta parcela não pode ser restaurada.'); END IF;
    v_ativo:=true; v_status:='pendente';
  ELSE
    IF p.status<>'paga' THEN RETURN jsonb_build_object('sucesso',false,'erro','Somente uma parcela quitada pode ser reaberta.'); END IF;
    IF length(trim(coalesce(p_motivo,'')))<3 THEN RETURN jsonb_build_object('sucesso',false,'erro','Informe o motivo para reabrir a parcela.'); END IF;
    v_ativo:=true; v_status:='pendente';
  END IF;
  UPDATE public.dividas_parcelas SET ativo=v_ativo,status=v_status,pago_em=NULL,pago_por=NULL,updated_by=v.usuario_id,updated_at=now()
  WHERE id=p_parcela_id AND empresa_id=v.empresa_id;
  PERFORM public.app_dividas_recalcular(p.divida_id,v.empresa_id);
  INSERT INTO public.dividas_auditoria(empresa_id,divida_id,parcela_id,usuario_id,evento,detalhes)
  VALUES(v.empresa_id,p.divida_id,p_parcela_id,v.usuario_id,'parcela_'||p_acao,jsonb_build_object('motivo',nullif(trim(coalesce(p_motivo,'')),'')));
  RETURN jsonb_build_object('sucesso',true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('sucesso',false,'erro','Não foi possível alterar o status da parcela.');
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_admin_divida_status(p_token text,p_divida_id uuid,p_acao text,p_motivo text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','extensions'
AS $function$
DECLARE v record; d record; v_status text;
BEGIN
  SELECT * INTO v FROM public.app_dividas_admin_context(p_token) LIMIT 1;
  SELECT * INTO d FROM public.dividas_gestao WHERE id=p_divida_id AND empresa_id=v.empresa_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('sucesso',false,'erro','Dívida não encontrada.'); END IF;
  IF p_acao='inativar' THEN
    IF d.status='inativa' THEN RETURN jsonb_build_object('sucesso',false,'erro','A dívida já está inativa.'); END IF;
    IF length(trim(coalesce(p_motivo,'')))<3 THEN RETURN jsonb_build_object('sucesso',false,'erro','Informe o motivo da inativação.'); END IF;
    v_status:='inativa';
  ELSIF p_acao='restaurar' THEN
    IF d.status<>'inativa' THEN RETURN jsonb_build_object('sucesso',false,'erro','A dívida não está inativa.'); END IF;
    v_status:=CASE WHEN d.saldo_devedor=0 THEN 'quitada' ELSE 'ativa' END;
  ELSE
    RETURN jsonb_build_object('sucesso',false,'erro','Ação inválida.');
  END IF;
  UPDATE public.dividas_gestao SET status=v_status,inativada_em=CASE WHEN v_status='inativa' THEN now() ELSE NULL END,updated_at=now()
  WHERE id=p_divida_id AND empresa_id=v.empresa_id;
  INSERT INTO public.dividas_auditoria(empresa_id,divida_id,usuario_id,evento,detalhes)
  VALUES(v.empresa_id,p_divida_id,v.usuario_id,'divida_'||p_acao,jsonb_build_object('motivo',nullif(trim(coalesce(p_motivo,'')),'')));
  RETURN jsonb_build_object('sucesso',true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('sucesso',false,'erro','Não foi possível alterar o status da dívida.');
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_admin_divida_parcela_quitar(p_token text,p_parcela_id uuid,p_pago_em date,p_forma_pagamento text,p_motivo text,p_documento jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','extensions'
AS $function$
DECLARE v record; p record; v_doc_path text; v_doc_name text; v_doc_mime text; v_doc_size bigint;
BEGIN
  SELECT * INTO v FROM public.app_dividas_admin_context(p_token) LIMIT 1;
  SELECT dp.*,d.status AS divida_status INTO p
  FROM public.dividas_parcelas dp JOIN public.dividas_gestao d ON d.id=dp.divida_id AND d.empresa_id=dp.empresa_id
  WHERE dp.id=p_parcela_id AND dp.empresa_id=v.empresa_id FOR UPDATE OF dp;
  IF NOT FOUND OR p.divida_status='inativa' OR p.status<>'pendente' OR p.ativo IS NOT TRUE THEN
    RETURN jsonb_build_object('sucesso',false,'erro','A parcela não está disponível para quitação.');
  END IF;
  IF p_pago_em IS NULL OR p_forma_pagamento NOT IN ('pix','transferencia','boleto','outro') THEN
    RETURN jsonb_build_object('sucesso',false,'erro','Informe a data e a forma de pagamento.');
  END IF;
  IF p_documento IS NOT NULL THEN
    v_doc_path:=p_documento->>'storage_path'; v_doc_name:=p_documento->>'arquivo_nome'; v_doc_mime:=p_documento->>'mime_type'; v_doc_size:=nullif(p_documento->>'tamanho_bytes','')::bigint;
    IF v_doc_path IS NULL OR v_doc_name IS NULL OR v_doc_mime NOT IN ('application/pdf','image/jpeg','image/png','image/webp') OR v_doc_size IS NULL OR v_doc_size<1 OR v_doc_size>10485760 OR v_doc_path NOT LIKE v.empresa_id::text||'/dividas/'||p_parcela_id::text||'/%' THEN
      RETURN jsonb_build_object('sucesso',false,'erro','Comprovante inválido.');
    END IF;
  END IF;
  UPDATE public.dividas_parcelas SET status='paga',pago_em=p_pago_em,forma_pagamento=p_forma_pagamento,pago_por=v.usuario_id,updated_by=v.usuario_id,updated_at=now()
  WHERE id=p_parcela_id AND empresa_id=v.empresa_id;
  IF p_documento IS NOT NULL THEN
    INSERT INTO public.dividas_arquivos(empresa_id,divida_id,parcela_id,tipo,storage_path,arquivo_nome,mime_type,tamanho_bytes,uploaded_by)
    VALUES(v.empresa_id,p.divida_id,p_parcela_id,'comprovante',v_doc_path,v_doc_name,v_doc_mime,v_doc_size,v.usuario_id);
  END IF;
  PERFORM public.app_dividas_recalcular(p.divida_id,v.empresa_id);
  INSERT INTO public.dividas_auditoria(empresa_id,divida_id,parcela_id,usuario_id,evento,detalhes)
  VALUES(v.empresa_id,p.divida_id,p_parcela_id,v.usuario_id,'parcela_quitada',jsonb_build_object('pago_em',p_pago_em,'forma_pagamento',p_forma_pagamento,'motivo',nullif(trim(coalesce(p_motivo,'')),''),'comprovante_anexado',p_documento IS NOT NULL));
  RETURN jsonb_build_object('sucesso',true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('sucesso',false,'erro','Não foi possível quitar a parcela.');
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_admin_divida_documento_preflight(p_token text,p_parcela_id uuid,p_tipo text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','extensions'
AS $function$
DECLARE v record; p record;
BEGIN
  SELECT * INTO v FROM public.app_dividas_admin_context(p_token) LIMIT 1;
  IF p_tipo NOT IN ('documento_pagamento','comprovante') THEN RETURN jsonb_build_object('sucesso',false,'erro','Tipo de documento inválido.'); END IF;
  SELECT dp.id,dp.divida_id,d.status AS divida_status,dp.status AS parcela_status,dp.ativo
  INTO p FROM public.dividas_parcelas dp JOIN public.dividas_gestao d ON d.id=dp.divida_id AND d.empresa_id=dp.empresa_id
  WHERE dp.id=p_parcela_id AND dp.empresa_id=v.empresa_id LIMIT 1;
  IF p.id IS NULL OR p.divida_status='inativa' OR p.parcela_status<>'pendente' OR p.ativo IS NOT TRUE THEN
    RETURN jsonb_build_object('sucesso',false,'erro','A parcela não permite anexos neste estado.');
  END IF;
  RETURN jsonb_build_object('sucesso',true,'empresa_id',v.empresa_id,'divida_id',p.divida_id,'parcela_id',p_parcela_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('sucesso',false,'erro','Acesso negado ao documento.');
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_admin_divida_documento_registrar(p_token text,p_parcela_id uuid,p_tipo text,p_storage_path text,p_arquivo_nome text,p_mime_type text,p_tamanho_bytes bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','extensions'
AS $function$
DECLARE v record; p record; v_id uuid;
BEGIN
  SELECT * INTO v FROM public.app_dividas_admin_context(p_token) LIMIT 1;
  SELECT dp.id,dp.divida_id,d.status AS divida_status,dp.status AS parcela_status,dp.ativo INTO p
  FROM public.dividas_parcelas dp JOIN public.dividas_gestao d ON d.id=dp.divida_id AND d.empresa_id=dp.empresa_id
  WHERE dp.id=p_parcela_id AND dp.empresa_id=v.empresa_id FOR UPDATE OF dp;
  IF NOT FOUND OR p.divida_status='inativa' OR p.parcela_status<>'pendente' OR p.ativo IS NOT TRUE THEN RETURN jsonb_build_object('sucesso',false,'erro','A parcela não permite este anexo.'); END IF;
  IF p_tipo<>'documento_pagamento' OR p_storage_path NOT LIKE v.empresa_id::text||'/dividas/'||p_parcela_id::text||'/%' OR length(trim(coalesce(p_arquivo_nome,'')))<1 OR p_mime_type NOT IN ('application/pdf','image/jpeg','image/png','image/webp') OR p_tamanho_bytes<1 OR p_tamanho_bytes>10485760 THEN
    RETURN jsonb_build_object('sucesso',false,'erro','Documento de pagamento inválido.');
  END IF;
  INSERT INTO public.dividas_arquivos(empresa_id,divida_id,parcela_id,tipo,storage_path,arquivo_nome,mime_type,tamanho_bytes,uploaded_by)
  VALUES(v.empresa_id,p.divida_id,p_parcela_id,p_tipo,p_storage_path,p_arquivo_nome,p_mime_type,p_tamanho_bytes,v.usuario_id)
  RETURNING id INTO v_id;
  INSERT INTO public.dividas_auditoria(empresa_id,divida_id,parcela_id,usuario_id,evento,detalhes)
  VALUES(v.empresa_id,p.divida_id,p_parcela_id,v.usuario_id,'documento_pagamento_anexado',jsonb_build_object('arquivo_nome',p_arquivo_nome,'mime_type',p_mime_type,'tamanho_bytes',p_tamanho_bytes));
  RETURN jsonb_build_object('sucesso',true,'id',v_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('sucesso',false,'erro','Não foi possível registrar o documento.');
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_admin_divida_documento_caminho(p_token text,p_arquivo_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','extensions'
AS $function$
DECLARE v record; a record;
BEGIN
  SELECT * INTO v FROM public.app_dividas_admin_context(p_token) LIMIT 1;
  SELECT id,storage_path,arquivo_nome,mime_type,tamanho_bytes INTO a
  FROM public.dividas_arquivos WHERE id=p_arquivo_id AND empresa_id=v.empresa_id LIMIT 1;
  IF a.id IS NULL THEN RETURN jsonb_build_object('sucesso',false,'erro','Arquivo não encontrado.'); END IF;
  RETURN jsonb_build_object('sucesso',true,'storage_path',a.storage_path,'arquivo_nome',a.arquivo_nome,'mime_type',a.mime_type);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('sucesso',false,'erro','Acesso negado ao arquivo.');
END;
$function$;

-- O módulo Financeiro deixa de expor dívidas e parcelas já transferidas para Dívidas.
CREATE OR REPLACE FUNCTION public.app_admin_financeiro(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','extensions'
AS $function$
DECLARE v record;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.perfil NOT IN ('admin','administrador','gestor') THEN RETURN jsonb_build_object('sucesso',false,'erro','Acesso negado'); END IF;
  RETURN jsonb_build_object(
    'sucesso',true,
    'contas',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.vencimento),'[]'::jsonb) FROM (SELECT id,tipo,categoria,descricao,valor,vencimento,status,pago_em,observacoes,fonte_documento FROM public.financeiro_lancamentos WHERE empresa_id=v.empresa_id ORDER BY vencimento DESC LIMIT 500)x),
    'dividas','[]'::jsonb,
    'recorrencias',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.proximo_vencimento),'[]'::jsonb) FROM (SELECT id,descricao,categoria,fornecedor,valor,periodicidade,proximo_vencimento,ativo FROM public.financeiro_recorrencias WHERE empresa_id=v.empresa_id ORDER BY proximo_vencimento LIMIT 300)x),
    'parcelas',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.vencimento),'[]'::jsonb) FROM (
      SELECT p.id,p.numero,p.valor,p.vencimento,p.status,p.pago_em,p.comprovante_nome,p.fonte_documento,s.credor,s.descricao
      FROM public.financeiro_parcelas p JOIN public.financeiro_parcelamentos s ON s.id=p.parcelamento_id
      WHERE p.empresa_id=v.empresa_id AND NOT EXISTS (SELECT 1 FROM public.dividas_gestao d WHERE d.parcelamento_origem_id=s.id LIMIT 1)
      ORDER BY p.vencimento LIMIT 1000
    )x)
  );
END;
$function$;

-- A RPC de direitos legada não divulga registros de dívida a gestores.
CREATE OR REPLACE FUNCTION public.app_admin_direitos(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','extensions'
AS $function$
DECLARE v record; v_dividas jsonb:='[]'::jsonb; v_result jsonb;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.perfil NOT IN ('admin','administrador','gestor') THEN RETURN jsonb_build_object('sucesso',false,'erro','Acesso negado'); END IF;
  IF public.app_dividas_admin_allowed(p_token) THEN
    SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.vencimento NULLS LAST),'[]'::jsonb) INTO v_dividas
    FROM (SELECT id,credor,descricao,valor_original,saldo_devedor,vencimento,status,observacoes FROM public.dividas_gestao WHERE empresa_id=v.empresa_id ORDER BY vencimento NULLS LAST LIMIT 500)x;
  END IF;
  SELECT jsonb_build_object(
    'dividas',v_dividas,
    'ordens',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.prazo NULLS LAST),'[]'::jsonb) FROM (SELECT id,numero,descricao,status,prioridade,prazo,quantidade,valor_total FROM public.ordens_servico WHERE empresa_id=v.empresa_id ORDER BY prazo NULLS LAST LIMIT 500)x),
    'producao',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.prazo NULLS LAST),'[]'::jsonb) FROM (SELECT id,nome,status,prazo,quantidade,responsavel FROM public.producao_lotes WHERE empresa_id=v.empresa_id ORDER BY prazo NULLS LAST LIMIT 500)x)
  ) INTO v_result;
  RETURN jsonb_build_object('sucesso',true)||v_result;
END;
$function$;

-- Desabilita o antigo update por ID, que não tinha filtro de empresa nem perfil estrito.
REVOKE ALL ON FUNCTION public.app_admin_atualizar_divida(text,uuid,text,numeric) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_atualizar_divida(text,uuid,text,numeric) TO service_role;

-- Impede que um parcelamento migrado seja baixado pelo formulário financeiro antigo.
CREATE OR REPLACE FUNCTION public.app_admin_quitar_parcela(p_token text,p_id uuid,p_comprovante_url text DEFAULT NULL,p_comprovante_nome text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','extensions'
AS $function$
DECLARE v record; v_parcelamento_id uuid; v_rows integer;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.perfil NOT IN ('admin','administrador','gestor') THEN RETURN jsonb_build_object('sucesso',false,'erro','Acesso negado'); END IF;
  SELECT parcelamento_id INTO v_parcelamento_id FROM public.financeiro_parcelas WHERE id=p_id AND empresa_id=v.empresa_id LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('sucesso',false,'erro','Parcela não encontrada.'); END IF;
  IF EXISTS (SELECT 1 FROM public.dividas_gestao d WHERE d.parcelamento_origem_id=v_parcelamento_id LIMIT 1) THEN
    RETURN jsonb_build_object('sucesso',false,'erro','Este parcelamento foi transferido para o módulo Dívidas.');
  END IF;
  UPDATE public.financeiro_parcelas SET status='pago',pago_em=current_date,comprovante_url=p_comprovante_url,comprovante_nome=p_comprovante_nome,baixado_por=v.usuario_id
  WHERE id=p_id AND empresa_id=v.empresa_id AND status<>'pago';
  GET DIAGNOSTICS v_rows=ROW_COUNT;
  IF v_rows=0 THEN RETURN jsonb_build_object('sucesso',false,'erro','A parcela já está paga ou não está disponível.'); END IF;
  RETURN jsonb_build_object('sucesso',true);
END;
$function$;

REVOKE ALL ON FUNCTION public.app_dividas_admin_context(text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.app_dividas_recalcular(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.app_admin_divida_parcela_quitar(text,uuid,date,text,text,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.app_admin_divida_documento_preflight(text,uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.app_admin_divida_documento_registrar(text,uuid,text,text,text,text,bigint) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.app_admin_divida_documento_caminho(text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.app_dividas_admin_allowed(text) TO anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.app_admin_dividas_dashboard(text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_divida_criar(text,jsonb) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_divida_atualizar(text,uuid,jsonb) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_divida_parcela_adicionar(text,uuid,jsonb) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_divida_parcela_atualizar(text,uuid,jsonb) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_divida_parcela_status(text,uuid,text,text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_divida_status(text,uuid,text,text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_divida_parcela_quitar(text,uuid,date,text,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.app_admin_divida_documento_preflight(text,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.app_admin_divida_documento_registrar(text,uuid,text,text,text,text,bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.app_admin_divida_documento_caminho(text,uuid) TO service_role;

COMMIT;
