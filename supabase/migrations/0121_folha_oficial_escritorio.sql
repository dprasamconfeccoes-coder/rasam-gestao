BEGIN;

CREATE TABLE public.folha_escritorio_registros (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id uuid NOT NULL, funcionario_id uuid NOT NULL,
 competencia text NOT NULL CHECK (competencia ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'), holerite_id uuid,
 status text NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho','confirmado')),
 salario_base numeric(14,2) CHECK (salario_base IS NULL OR salario_base>=0), base_inss numeric(14,2) CHECK (base_inss IS NULL OR base_inss>=0), base_fgts numeric(14,2) CHECK (base_fgts IS NULL OR base_fgts>=0), fgts_mes numeric(14,2) CHECK (fgts_mes IS NULL OR fgts_mes>=0),
 base_irrf numeric(14,2) CHECK (base_irrf IS NULL OR base_irrf>=0), faixa_irrf text, total_vencimentos numeric(14,2) NOT NULL DEFAULT 0 CHECK (total_vencimentos>=0),
 total_descontos numeric(14,2) NOT NULL DEFAULT 0 CHECK (total_descontos>=0), valor_liquido numeric(14,2) NOT NULL DEFAULT 0 CHECK (valor_liquido>=0),
 created_by uuid NOT NULL, updated_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (empresa_id, funcionario_id, competencia),
 FOREIGN KEY (holerite_id) REFERENCES public.holerites(id) ON DELETE SET NULL
);
CREATE TABLE public.folha_escritorio_itens (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), registro_id uuid NOT NULL REFERENCES public.folha_escritorio_registros(id) ON DELETE CASCADE,
 ordem integer NOT NULL, codigo text, descricao text NOT NULL, referencia text, tipo text NOT NULL CHECK (tipo IN ('provento','desconto','informativo')),
 valor numeric(14,2) NOT NULL CHECK (valor >= 0), UNIQUE(registro_id,ordem)
);
CREATE TABLE public.folha_escritorio_historico (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id uuid NOT NULL, registro_id uuid NOT NULL,
 funcionario_id uuid NOT NULL, competencia text NOT NULL, acao text NOT NULL CHECK (acao IN ('salvou_rascunho','confirmou','reabriu')),
 motivo text, snapshot jsonb NOT NULL, usuario_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.folha_escritorio_historico(registro_id,created_at);
ALTER TABLE public.folha_escritorio_registros ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.folha_escritorio_itens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.folha_escritorio_historico ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.folha_escritorio_registros, public.folha_escritorio_itens, public.folha_escritorio_historico FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.app_admin_folha_escritorio_listar(p_token text,p_competencia text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE v record; ini date; fim date; elig integer; conf integer; dr integer; funcionarios jsonb; tv numeric; td numeric; vl numeric;
BEGIN
 SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
 IF v.usuario_id IS NULL OR v.empresa_id IS NULL OR v.perfil NOT IN ('admin','administrador') THEN RETURN jsonb_build_object('sucesso',false,'erro','Acesso negado'); END IF;
 IF p_competencia IS NULL OR p_competencia !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN RETURN jsonb_build_object('sucesso',false,'erro','Competência inválida'); END IF;
 ini:=to_date(p_competencia||'-01','YYYY-MM-DD'); fim:=(ini+interval '1 month - 1 day')::date;
 WITH e AS (
 SELECT f.id funcionario_id,f.nome,f.cargo,r.id registro_id,coalesce(r.holerite_id,latest.id) holerite_id,r.status,r.salario_base,r.base_inss,r.base_fgts,r.fgts_mes,r.base_irrf,r.faixa_irrf,r.total_vencimentos,r.total_descontos,r.valor_liquido,
   coalesce(h.arquivo_nome,latest.arquivo_nome) arquivo_nome,coalesce(h.mime_type,latest.mime_type) mime_type,
   CASE WHEN r.holerite_id IS NOT NULL THEN coalesce(h.disponivel,false) AND nullif(btrim(h.storage_path),'') IS NOT NULL ELSE coalesce(latest.disponivel,false) AND nullif(btrim(latest.storage_path),'') IS NOT NULL END documento_disponivel
 FROM public.funcionarios f
 LEFT JOIN public.folha_escritorio_registros r ON r.empresa_id=f.empresa_id AND r.funcionario_id=f.id AND r.competencia=p_competencia
 LEFT JOIN public.holerites h ON h.id=r.holerite_id AND h.empresa_id=f.empresa_id
 LEFT JOIN LATERAL (SELECT h2.id,h2.arquivo_nome,h2.mime_type,h2.disponivel,h2.storage_path FROM public.holerites h2 WHERE h2.empresa_id=f.empresa_id AND h2.funcionario_id=f.id AND h2.mes=extract(month FROM ini)::int AND h2.ano=extract(year FROM ini)::int ORDER BY h2.created_at DESC LIMIT 1) latest ON true
 WHERE f.empresa_id=v.empresa_id AND coalesce(f.ativo,false) AND coalesce(f.elegivel_holerite,f.tipo_vinculo='formal') AND (f.data_admissao IS NULL OR f.data_admissao<=fim) AND (coalesce(f.data_saida,f.data_demissao) IS NULL OR coalesce(f.data_saida,f.data_demissao)>=ini)
 ORDER BY f.nome LIMIT 1000)
 SELECT count(*)::int,count(*) FILTER(WHERE status='confirmado')::int,count(*) FILTER(WHERE status='rascunho')::int,
 coalesce(jsonb_agg(jsonb_build_object('funcionario_id',e.funcionario_id,'nome',e.nome,'cargo',e.cargo,'status',coalesce(e.status,'pendente'),'registro_id',e.registro_id,'holerite_id',e.holerite_id,'arquivo_nome',e.arquivo_nome,'mime_type',e.mime_type,'documento_disponivel',coalesce(e.documento_disponivel,false),'salario_base',e.salario_base,'base_inss',e.base_inss,'base_fgts',e.base_fgts,'fgts_mes',e.fgts_mes,'base_irrf',e.base_irrf,'faixa_irrf',e.faixa_irrf,'total_vencimentos',CASE WHEN e.status='confirmado' THEN e.total_vencimentos END,'total_descontos',CASE WHEN e.status='confirmado' THEN e.total_descontos END,'valor_liquido',CASE WHEN e.status='confirmado' THEN e.valor_liquido END,'itens',coalesce((SELECT jsonb_agg(jsonb_build_object('ordem',i.ordem,'codigo',i.codigo,'descricao',i.descricao,'referencia',i.referencia,'tipo',i.tipo,'valor',i.valor) ORDER BY i.ordem) FROM public.folha_escritorio_itens i WHERE i.registro_id=e.registro_id),'[]'::jsonb)) ORDER BY e.nome),'[]'::jsonb),
 coalesce(sum(e.total_vencimentos) FILTER(WHERE e.status='confirmado'),0),coalesce(sum(e.total_descontos) FILTER(WHERE e.status='confirmado'),0),coalesce(sum(e.valor_liquido) FILTER(WHERE e.status='confirmado'),0)
 INTO elig,conf,dr,funcionarios,tv,td,vl FROM e;
 RETURN jsonb_build_object('sucesso',true,'competencia',p_competencia,'funcionarios_elegiveis',elig,'confirmados',conf,'rascunhos',dr,'pendentes',elig-conf-dr,'status_competencia',CASE WHEN elig=0 THEN 'sem_vinculos' WHEN conf=elig THEN 'completa' WHEN conf=0 THEN 'sem_oficiais' ELSE 'parcial' END,'total_vencimentos_oficiais',tv,'total_descontos_oficiais',td,'valor_liquido_oficial',vl,'funcionarios',funcionarios);
END $$;

CREATE OR REPLACE FUNCTION public.app_admin_folha_escritorio_salvar(p_token text,p_funcionario_id uuid,p_competencia text,p_dados jsonb,p_confirmar boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE v record; f record; r public.folha_escritorio_registros%ROWTYPE; a jsonb; n integer; sprov numeric; sdesc numeric; hv public.holerites%ROWTYPE; act text;
BEGIN
 SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
 IF v.usuario_id IS NULL OR v.empresa_id IS NULL OR v.perfil NOT IN ('admin','administrador') THEN RETURN jsonb_build_object('sucesso',false,'erro','Acesso negado'); END IF;
 IF p_competencia IS NULL OR p_competencia !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' OR jsonb_typeof(p_dados)<>'object' THEN RETURN jsonb_build_object('sucesso',false,'erro','Dados inválidos'); END IF;
 SELECT * INTO f FROM public.funcionarios WHERE id=p_funcionario_id AND empresa_id=v.empresa_id AND coalesce(ativo,false) AND coalesce(elegivel_holerite,tipo_vinculo='formal') AND (data_admissao IS NULL OR data_admissao<=(to_date(p_competencia||'-01','YYYY-MM-DD')+interval '1 month - 1 day')::date) AND (coalesce(data_saida,data_demissao) IS NULL OR coalesce(data_saida,data_demissao)>=to_date(p_competencia||'-01','YYYY-MM-DD')) LIMIT 1;
 IF f.id IS NULL THEN RETURN jsonb_build_object('sucesso',false,'erro','Funcionário não elegível nesta empresa e competência'); END IF;
 a:=coalesce(p_dados->'itens','[]'::jsonb); IF jsonb_typeof(a)<>'array' OR jsonb_array_length(a)>100 THEN RETURN jsonb_build_object('sucesso',false,'erro','Máximo de 100 rubricas'); END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(a) x WHERE coalesce(x->>'tipo','') NOT IN ('provento','desconto','informativo') OR nullif(btrim(x->>'descricao'),'') IS NULL OR coalesce(x->>'valor','') !~ '^([0-9]+)(\.[0-9]{1,2})?$' OR (x->>'valor')::numeric<0) THEN RETURN jsonb_build_object('sucesso',false,'erro','Rubrica ou valor inválido'); END IF;
 IF EXISTS(SELECT 1 FROM (VALUES ('salario_base'),('base_inss'),('base_fgts'),('fgts_mes'),('base_irrf'),('total_vencimentos'),('total_descontos'),('valor_liquido')) q(k) WHERE p_dados->>q.k IS NOT NULL AND (p_dados->>q.k !~ '^([0-9]+)(\.[0-9]{1,2})?$' OR (p_dados->>q.k)::numeric<0)) THEN RETURN jsonb_build_object('sucesso',false,'erro','Valores monetários devem ser não negativos e ter até duas casas decimais'); END IF;
 IF nullif(p_dados->>'holerite_id','') IS NOT NULL THEN
  SELECT * INTO hv FROM public.holerites WHERE id=(p_dados->>'holerite_id')::uuid AND empresa_id=v.empresa_id AND funcionario_id=p_funcionario_id AND mes=substring(p_competencia,6,2)::int AND ano=substring(p_competencia,1,4)::int LIMIT 1;
  IF hv.id IS NULL THEN RETURN jsonb_build_object('sucesso',false,'erro','Holerite vinculado não pertence ao funcionário e competência selecionados'); END IF;
 END IF;
 IF p_confirmar THEN
  IF jsonb_array_length(a)=0 OR nullif(p_dados->>'total_vencimentos','') IS NULL OR nullif(p_dados->>'total_descontos','') IS NULL OR nullif(p_dados->>'valor_liquido','') IS NULL THEN RETURN jsonb_build_object('sucesso',false,'erro','Informe rubricas e os três totais antes de confirmar'); END IF;
  IF EXISTS(SELECT 1 FROM (VALUES ('total_vencimentos'),('total_descontos'),('valor_liquido')) q(k) WHERE coalesce(p_dados->>q.k,'') !~ '^([0-9]+)(\.[0-9]{1,2})?$') THEN RETURN jsonb_build_object('sucesso',false,'erro','Totais oficiais inválidos'); END IF;
  IF hv.id IS NULL THEN RETURN jsonb_build_object('sucesso',false,'erro','Documento privado obrigatório para confirmar'); END IF;
  IF NOT coalesce(hv.disponivel,false) OR nullif(btrim(hv.storage_path),'') IS NULL OR hv.mime_type NOT IN ('application/pdf','image/jpeg','image/png') THEN RETURN jsonb_build_object('sucesso',false,'erro','Documento privado não disponível para este funcionário e competência'); END IF;
  SELECT coalesce(sum((x->>'valor')::numeric) FILTER(WHERE x->>'tipo'='provento'),0),coalesce(sum((x->>'valor')::numeric) FILTER(WHERE x->>'tipo'='desconto'),0) INTO sprov,sdesc FROM jsonb_array_elements(a) x;
  IF sprov<>coalesce((p_dados->>'total_vencimentos')::numeric,0) OR sdesc<>coalesce((p_dados->>'total_descontos')::numeric,0) OR coalesce((p_dados->>'valor_liquido')::numeric,0)<>sprov-sdesc THEN RETURN jsonb_build_object('sucesso',false,'erro','Totais não conciliam com as rubricas'); END IF;
 END IF;
 SELECT * INTO r FROM public.folha_escritorio_registros WHERE empresa_id=v.empresa_id AND funcionario_id=p_funcionario_id AND competencia=p_competencia FOR UPDATE;
 IF r.id IS NOT NULL AND r.status='confirmado' THEN RETURN jsonb_build_object('sucesso',false,'erro','Registro confirmado; reabra explicitamente antes de editar'); END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(a))>100 THEN RETURN jsonb_build_object('sucesso',false,'erro','Máximo de 100 rubricas'); END IF;
 IF r.id IS NULL THEN INSERT INTO public.folha_escritorio_registros(empresa_id,funcionario_id,competencia,holerite_id,status,salario_base,base_inss,base_fgts,fgts_mes,base_irrf,faixa_irrf,total_vencimentos,total_descontos,valor_liquido,created_by,updated_by) VALUES(v.empresa_id,p_funcionario_id,p_competencia,nullif(p_dados->>'holerite_id','')::uuid,CASE WHEN p_confirmar THEN 'confirmado' ELSE 'rascunho' END,nullif(p_dados->>'salario_base','')::numeric,nullif(p_dados->>'base_inss','')::numeric,nullif(p_dados->>'base_fgts','')::numeric,nullif(p_dados->>'fgts_mes','')::numeric,nullif(p_dados->>'base_irrf','')::numeric,nullif(p_dados->>'faixa_irrf',''),coalesce(nullif(p_dados->>'total_vencimentos','')::numeric,0),coalesce(nullif(p_dados->>'total_descontos','')::numeric,0),coalesce(nullif(p_dados->>'valor_liquido','')::numeric,0),v.usuario_id,v.usuario_id) RETURNING * INTO r;
 ELSE UPDATE public.folha_escritorio_registros SET holerite_id=nullif(p_dados->>'holerite_id','')::uuid,status=CASE WHEN p_confirmar THEN 'confirmado' ELSE 'rascunho' END,salario_base=nullif(p_dados->>'salario_base','')::numeric,base_inss=nullif(p_dados->>'base_inss','')::numeric,base_fgts=nullif(p_dados->>'base_fgts','')::numeric,fgts_mes=nullif(p_dados->>'fgts_mes','')::numeric,base_irrf=nullif(p_dados->>'base_irrf','')::numeric,faixa_irrf=nullif(p_dados->>'faixa_irrf',''),total_vencimentos=coalesce(nullif(p_dados->>'total_vencimentos','')::numeric,0),total_descontos=coalesce(nullif(p_dados->>'total_descontos','')::numeric,0),valor_liquido=coalesce(nullif(p_dados->>'valor_liquido','')::numeric,0),updated_by=v.usuario_id,updated_at=now() WHERE id=r.id RETURNING * INTO r; END IF;
 DELETE FROM public.folha_escritorio_itens WHERE registro_id=r.id;
 INSERT INTO public.folha_escritorio_itens(registro_id,ordem,codigo,descricao,referencia,tipo,valor) SELECT r.id,ord,elem->>'codigo',btrim(elem->>'descricao'),elem->>'referencia',elem->>'tipo',(elem->>'valor')::numeric FROM jsonb_array_elements(a) WITH ORDINALITY q(elem,ord);
 act:=CASE WHEN p_confirmar THEN 'confirmou' ELSE 'salvou_rascunho' END;
 INSERT INTO public.folha_escritorio_historico(empresa_id,registro_id,funcionario_id,competencia,acao,snapshot,usuario_id) VALUES(v.empresa_id,r.id,p_funcionario_id,p_competencia,act,jsonb_build_object('status',r.status,'holerite_id',r.holerite_id,'salario_base',r.salario_base,'base_inss',r.base_inss,'base_fgts',r.base_fgts,'fgts_mes',r.fgts_mes,'base_irrf',r.base_irrf,'faixa_irrf',r.faixa_irrf,'total_vencimentos',r.total_vencimentos,'total_descontos',r.total_descontos,'valor_liquido',r.valor_liquido,'itens',a),v.usuario_id);
 RETURN jsonb_build_object('sucesso',true,'registro_id',r.id,'status',r.status);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('sucesso',false,'erro','Dados da folha inválidos'); END $$;

CREATE OR REPLACE FUNCTION public.app_admin_folha_escritorio_reabrir(p_token text,p_registro_id uuid,p_motivo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$ DECLARE v record; r public.folha_escritorio_registros%ROWTYPE; snap jsonb; BEGIN
 SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
 IF v.usuario_id IS NULL OR v.empresa_id IS NULL OR v.perfil NOT IN ('admin','administrador') THEN RETURN jsonb_build_object('sucesso',false,'erro','Acesso negado'); END IF;
 IF length(btrim(coalesce(p_motivo,'')))<5 THEN RETURN jsonb_build_object('sucesso',false,'erro','Informe o motivo da reabertura (mínimo de 5 caracteres)'); END IF;
 SELECT * INTO r FROM public.folha_escritorio_registros WHERE id=p_registro_id AND empresa_id=v.empresa_id FOR UPDATE;
 IF r.id IS NULL OR r.status<>'confirmado' THEN RETURN jsonb_build_object('sucesso',false,'erro','Registro confirmado não encontrado'); END IF;
 -- Capture a complete pre-transition snapshot without employee identity details.
 SELECT jsonb_build_object('status',r.status,'holerite_id',r.holerite_id,'salario_base',r.salario_base,'base_inss',r.base_inss,'base_fgts',r.base_fgts,'fgts_mes',r.fgts_mes,'base_irrf',r.base_irrf,'faixa_irrf',r.faixa_irrf,'total_vencimentos',r.total_vencimentos,'total_descontos',r.total_descontos,'valor_liquido',r.valor_liquido,'itens',coalesce((SELECT jsonb_agg(jsonb_build_object('ordem',i.ordem,'codigo',i.codigo,'descricao',i.descricao,'referencia',i.referencia,'tipo',i.tipo,'valor',i.valor) ORDER BY i.ordem) FROM public.folha_escritorio_itens i WHERE i.registro_id=r.id),'[]'::jsonb)) INTO snap;
 INSERT INTO public.folha_escritorio_historico(empresa_id,registro_id,funcionario_id,competencia,acao,motivo,snapshot,usuario_id) VALUES(v.empresa_id,r.id,r.funcionario_id,r.competencia,'reabriu',left(btrim(p_motivo),1000),snap,v.usuario_id);
 UPDATE public.folha_escritorio_registros SET status='rascunho',updated_by=v.usuario_id,updated_at=now() WHERE id=r.id;
 RETURN jsonb_build_object('sucesso',true,'registro_id',r.id,'status','rascunho'); END $$;

CREATE OR REPLACE FUNCTION public.app_admin_registrar_holerite_upload(p_token text,p_funcionario_id uuid,p_mes integer,p_ano integer,p_storage_path text,p_arquivo_nome text,p_mime_type text,p_tamanho_bytes bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$ DECLARE v record; f record; v_id uuid; v_path text; BEGIN
 SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
 IF v.usuario_id IS NULL OR v.perfil NOT IN ('gestor','administrador','admin') THEN RETURN jsonb_build_object('sucesso',false,'erro','Acesso negado'); END IF;
 IF p_mes NOT BETWEEN 1 AND 12 OR p_ano NOT BETWEEN 2000 AND 2100 THEN RETURN jsonb_build_object('sucesso',false,'erro','Competência inválida'); END IF;
 IF coalesce(p_mime_type,'') NOT IN ('application/pdf','image/jpeg','image/png') OR coalesce(p_tamanho_bytes,0)<1 OR p_tamanho_bytes>10485760 THEN RETURN jsonb_build_object('sucesso',false,'erro','Arquivo deve ser PDF, JPEG ou PNG de até 10 MB'); END IF;
 SELECT id,nome,ativo,coalesce(elegivel_holerite,tipo_vinculo='formal') elegivel_holerite INTO f FROM public.funcionarios WHERE id=p_funcionario_id AND empresa_id=v.empresa_id LIMIT 1;
 IF f.id IS NULL OR NOT coalesce(f.ativo,false) OR NOT coalesce(f.elegivel_holerite,false) THEN RETURN jsonb_build_object('sucesso',false,'erro','Funcionário não elegível para holerite'); END IF;
 v_path:=btrim(coalesce(p_storage_path,'')); IF length(v_path)<20 OR length(v_path)>512 OR v_path !~ ('^'||v.empresa_id::text||'/holerites/'||p_funcionario_id::text||'/[0-9]{4}-[0-9]{2}/[A-Za-z0-9_.-]{1,240}$') THEN RETURN jsonb_build_object('sucesso',false,'erro','Caminho privado inválido'); END IF;
 IF EXISTS(SELECT 1 FROM public.folha_escritorio_registros WHERE empresa_id=v.empresa_id AND funcionario_id=p_funcionario_id AND competencia=format('%s-%s',p_ano,lpad(p_mes::text,2,'0')) AND status='confirmado') THEN RETURN jsonb_build_object('sucesso',false,'erro','Reabra a folha oficial antes de substituir o holerite'); END IF;
 SELECT id INTO v_id FROM public.holerites WHERE funcionario_id=p_funcionario_id AND empresa_id=v.empresa_id AND mes=p_mes AND ano=p_ano ORDER BY created_at DESC LIMIT 1;
 IF v_id IS NULL THEN INSERT INTO public.holerites(funcionario_id,empresa_id,mes,ano,arquivo_nome,arquivo_url,storage_path,mime_type,tamanho_bytes,disponivel) VALUES(p_funcionario_id,v.empresa_id,p_mes,p_ano,left(btrim(p_arquivo_nome),255),v_path,v_path,p_mime_type,p_tamanho_bytes,true) RETURNING id INTO v_id;
 ELSE UPDATE public.holerites SET arquivo_nome=left(btrim(p_arquivo_nome),255),arquivo_url=v_path,storage_path=v_path,mime_type=p_mime_type,tamanho_bytes=p_tamanho_bytes,disponivel=true WHERE id=v_id; END IF;
 INSERT INTO public.auditoria_acoes(usuario_id,acao,entidade,entidade_id,detalhes) VALUES(v.usuario_id,'importou_holerite','holerites',v_id,jsonb_build_object('funcionario_id',p_funcionario_id,'mes',p_mes,'ano',p_ano,'arquivo_nome',p_arquivo_nome));
 RETURN jsonb_build_object('sucesso',true,'id',v_id,'arquivo_nome',p_arquivo_nome);
END $$;

CREATE OR REPLACE FUNCTION public.app_admin_holerites_competencia_resumo(p_token text,p_competencia text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$ DECLARE v_usuario record; v_inicio date; v_fim date; v_total int:=0; v_recebidos int:=0; v_ausentes int:=0; v_reenvio int:=0; v_pendencias jsonb:='[]'::jsonb; BEGIN
 SELECT * INTO v_usuario FROM public.app_tenant_usuario(p_token) LIMIT 1;
 IF v_usuario.usuario_id IS NULL OR v_usuario.empresa_id IS NULL OR v_usuario.perfil NOT IN ('gestor','admin','administrador') THEN RETURN jsonb_build_object('sucesso',false,'erro','Acesso negado'); END IF;
 IF p_competencia IS NULL OR p_competencia !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN RETURN jsonb_build_object('sucesso',false,'erro','Competência deve estar no formato AAAA-MM'); END IF;
 v_inicio:=to_date(p_competencia||'-01','YYYY-MM-DD'); v_fim:=(v_inicio+interval '1 month - 1 day')::date;
 WITH e AS (SELECT f.id funcionario_id,f.nome,CASE WHEN EXISTS(SELECT 1 FROM public.holerites h WHERE h.empresa_id=v_usuario.empresa_id AND h.funcionario_id=f.id AND h.mes=extract(month FROM v_inicio)::int AND h.ano=extract(year FROM v_inicio)::int AND coalesce(h.disponivel,false) AND nullif(btrim(h.storage_path),'') IS NOT NULL AND h.mime_type IN ('application/pdf','image/jpeg','image/png')) THEN 'recebido' WHEN EXISTS(SELECT 1 FROM public.holerites h WHERE h.empresa_id=v_usuario.empresa_id AND h.funcionario_id=f.id AND h.mes=extract(month FROM v_inicio)::int AND h.ano=extract(year FROM v_inicio)::int) THEN 'reenvio' ELSE 'ausente' END status FROM public.funcionarios f WHERE f.empresa_id=v_usuario.empresa_id AND coalesce(f.ativo,false) AND coalesce(f.elegivel_holerite,f.tipo_vinculo='formal') AND (f.data_admissao IS NULL OR f.data_admissao<=v_fim) AND (coalesce(f.data_saida,f.data_demissao) IS NULL OR coalesce(f.data_saida,f.data_demissao)>=v_inicio))
 SELECT count(*)::int,count(*) FILTER(WHERE status='recebido')::int,count(*) FILTER(WHERE status='ausente')::int,count(*) FILTER(WHERE status='reenvio')::int,coalesce((SELECT jsonb_agg(jsonb_build_object('funcionario_id',x.funcionario_id,'nome',x.nome,'status',x.status) ORDER BY x.nome) FROM (SELECT * FROM e WHERE status<>'recebido' ORDER BY nome LIMIT 1000)x),'[]'::jsonb) INTO v_total,v_recebidos,v_ausentes,v_reenvio,v_pendencias FROM e;
 RETURN jsonb_build_object('sucesso',true,'competencia',p_competencia,'funcionarios_elegiveis',v_total,'holerites_privados_recebidos',v_recebidos,'holerites_ausentes',v_ausentes,'holerites_reenvio',v_reenvio,'pendencias_total',v_ausentes+v_reenvio,'pendencias_limitadas',v_ausentes+v_reenvio>1000,'cobertura_percentual',CASE WHEN v_total=0 THEN NULL ELSE round(v_recebidos*100.0/v_total,1) END,'pendencias',v_pendencias,'escopo','Vínculos ativos elegíveis; conta arquivos privados PDF, JPEG e PNG.'); END $$;

REVOKE ALL ON FUNCTION public.app_admin_folha_escritorio_listar(text,text),public.app_admin_folha_escritorio_salvar(text,uuid,text,jsonb,boolean),public.app_admin_folha_escritorio_reabrir(text,uuid,text),public.app_admin_registrar_holerite_upload(text,uuid,integer,integer,text,text,text,bigint),public.app_admin_holerites_competencia_resumo(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_admin_folha_escritorio_listar(text,text),public.app_admin_folha_escritorio_salvar(text,uuid,text,jsonb,boolean),public.app_admin_folha_escritorio_reabrir(text,uuid,text),public.app_admin_registrar_holerite_upload(text,uuid,integer,integer,text,text,text,bigint),public.app_admin_holerites_competencia_resumo(text,text) TO anon,authenticated;
COMMIT;
