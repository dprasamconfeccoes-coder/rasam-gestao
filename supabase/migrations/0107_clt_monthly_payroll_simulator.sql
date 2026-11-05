BEGIN;

-- Guarda as declarações necessárias à simulação por funcionário e competência.
-- Nenhum valor é inferido de beneficiários em texto livre nem vira pagamento.
CREATE TABLE IF NOT EXISTS public.rh_folha_dados_competencia (
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  funcionario_id uuid NOT NULL REFERENCES public.funcionarios(id) ON DELETE CASCADE,
  competencia date NOT NULL CHECK (extract(day FROM competencia) = 1),
  salario_base numeric(14,2) NOT NULL CHECK (salario_base > 0),
  dependentes_irrf smallint NOT NULL CHECK (dependentes_irrf BETWEEN 0 AND 30),
  outros_vinculos text NOT NULL CHECK (outros_vinculos IN ('nao','sim')),
  outras_fontes_rendimento text NOT NULL CHECK (outras_fontes_rendimento IN ('nao','sim')),
  pensao_alimenticia numeric(14,2) NOT NULL DEFAULT 0 CHECK (pensao_alimenticia >= 0),
  pensao_confirmada boolean NOT NULL DEFAULT false,
  declaracao_confirmada boolean NOT NULL DEFAULT false,
  confirmado_por uuid,
  confirmado_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, funcionario_id, competencia)
);

COMMENT ON TABLE public.rh_folha_dados_competencia IS
  'Dados declarados para simulação interna mensal de INSS/IRRF; não constituem autorização de pagamento, transmissão ou recolhimento.';

ALTER TABLE public.rh_folha_dados_competencia ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rh_folha_dados_competencia FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.app_folha_2026_calcular_inss(p_base numeric)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_base numeric := least(greatest(coalesce(p_base,0),0),8475.55);
  v_total numeric;
BEGIN
  v_total := least(v_base,1621.00) * 0.075
    + least(greatest(v_base-1621.00,0),1281.84) * 0.09
    + least(greatest(v_base-2902.84,0),1451.43) * 0.12
    + least(greatest(v_base-4354.27,0),4121.28) * 0.14;
  RETURN round(v_total,2);
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_folha_2026_calcular_irrf(
  p_rendimentos_tributaveis numeric,
  p_inss numeric,
  p_dependentes integer,
  p_pensao numeric
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_rendimentos numeric := greatest(coalesce(p_rendimentos_tributaveis,0),0);
  v_dependentes integer := greatest(coalesce(p_dependentes,0),0);
  v_inss numeric := greatest(coalesce(p_inss,0),0);
  v_pensao numeric := greatest(coalesce(p_pensao,0),0);
  v_deducao_legal numeric;
  v_deducao_simplificada numeric;
  v_deducao_usada numeric;
  v_base numeric;
  v_aliquota numeric;
  v_parcela numeric;
  v_imposto numeric;
  v_redutor numeric;
  v_irrf numeric;
BEGIN
  v_deducao_legal := v_inss + (v_dependentes * 189.59) + v_pensao;
  v_deducao_simplificada := least(v_rendimentos,607.20);
  v_deducao_usada := greatest(v_deducao_legal,v_deducao_simplificada);
  v_base := greatest(v_rendimentos-v_deducao_usada,0);

  IF v_base <= 2428.80 THEN
    v_aliquota := 0; v_parcela := 0;
  ELSIF v_base <= 2826.65 THEN
    v_aliquota := 0.075; v_parcela := 182.16;
  ELSIF v_base <= 3751.05 THEN
    v_aliquota := 0.15; v_parcela := 394.16;
  ELSIF v_base <= 4664.68 THEN
    v_aliquota := 0.225; v_parcela := 675.49;
  ELSE
    v_aliquota := 0.275; v_parcela := 908.73;
  END IF;

  v_imposto := greatest(v_base*v_aliquota-v_parcela,0);
  IF v_rendimentos <= 5000.00 THEN
    v_redutor := 312.89;
  ELSIF v_rendimentos <= 7350.00 THEN
    v_redutor := greatest(978.62-(0.133145*v_rendimentos),0);
  ELSE
    v_redutor := 0;
  END IF;
  v_irrf := greatest(v_imposto-least(v_imposto,v_redutor),0);

  RETURN jsonb_build_object(
    'rendimentos_tributaveis',round(v_rendimentos,2),
    'deducao_legal',round(v_deducao_legal,2),
    'desconto_simplificado',round(v_deducao_simplificada,2),
    'deducao_utilizada',round(v_deducao_usada,2),
    'base_irrf',round(v_base,2),
    'aliquota',v_aliquota,
    'parcela_a_deduzir',round(v_parcela,2),
    'irrf_antes_redutor',round(v_imposto,2),
    'redutor_lei_15270',round(least(v_imposto,v_redutor),2),
    'irrf',round(v_irrf,2)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_admin_folha_dados_listar(p_token text,p_competencia text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','extensions'
AS $function$
DECLARE
  v_usuario record;
  v_competencia date;
  v_inicio date;
  v_fim date;
  v_funcionarios jsonb;
BEGIN
  SELECT * INTO v_usuario FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v_usuario.usuario_id IS NULL OR v_usuario.empresa_id IS NULL
     OR v_usuario.perfil NOT IN ('admin','administrador') THEN
    RETURN jsonb_build_object('sucesso',false,'erro','Acesso negado');
  END IF;
  IF p_competencia IS NULL OR p_competencia !~ '^2026-(0[1-9]|1[0-2])$' THEN
    RETURN jsonb_build_object('sucesso',false,'erro','A simulação inicial está disponível somente para competências de 2026, no formato AAAA-MM');
  END IF;
  v_competencia := to_date(p_competencia||'-01','YYYY-MM-DD');
  v_inicio := v_competencia;
  v_fim := (v_competencia + interval '1 month - 1 day')::date;

  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.nome),'[]'::jsonb) INTO v_funcionarios
  FROM (
    SELECT f.id AS funcionario_id,f.nome,f.cargo,f.tipo_vinculo,f.registrado,
      f.salario AS salario_atual,f.salario_periodo,
      d.salario_base,d.dependentes_irrf,d.outros_vinculos,d.outras_fontes_rendimento,
      d.pensao_alimenticia,d.pensao_confirmada,d.declaracao_confirmada,d.confirmado_em,
      (d.funcionario_id IS NOT NULL) AS dados_confirmados
    FROM public.funcionarios f
    LEFT JOIN public.rh_folha_dados_competencia d
      ON d.empresa_id=v_usuario.empresa_id AND d.funcionario_id=f.id AND d.competencia=v_competencia
    WHERE f.empresa_id=v_usuario.empresa_id
      AND f.tipo_vinculo='formal' AND f.registrado=true AND coalesce(f.ativo,false)=true
      AND f.data_admissao IS NOT NULL AND f.data_admissao<=v_fim
      AND (coalesce(f.data_saida,f.data_demissao) IS NULL OR coalesce(f.data_saida,f.data_demissao)>=v_inicio)
    ORDER BY f.nome
    LIMIT 1000
  ) x;

  RETURN jsonb_build_object(
    'sucesso',true,'competencia',p_competencia,'funcionarios',v_funcionarios,
    'regras',jsonb_build_object(
      'versao','CLT_MENSAL_2026_PRELIMINAR_V1',
      'inss_teto',8475.55,'inss_piso_faixa',1621.00,
      'dependente_irrf',189.59,'desconto_simplificado',607.20,
      'redutor_irrf_ate',5000.00,'redutor_irrf_faixa_final',7350.00,
      'fontes',jsonb_build_array(
        'https://www.gov.br/inss/pt-br/direitos-e-deveres/inscricao-e-contribuicao/tabela-de-contribuicao-mensal',
        'https://www.gov.br/previdencia/pt-br/assuntos/rpps/documentos/PortariaInterministerialMPSMF13de9dejaneirode2026.pdf',
        'https://www.gov.br/receitafederal/pt-br/assuntos/meu-imposto-de-renda/tabelas/2026',
        'https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2025/lei/l15270.htm'
      )
    )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_admin_folha_dados_salvar(
  p_token text,
  p_funcionario_id uuid,
  p_competencia text,
  p_salario_base numeric,
  p_dependentes_irrf integer,
  p_outros_vinculos text,
  p_outras_fontes_rendimento text,
  p_pensao_alimenticia numeric,
  p_pensao_confirmada boolean,
  p_declaracao_confirmada boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','extensions'
AS $function$
DECLARE
  v_usuario record;
  v_funcionario record;
  v_competencia date;
BEGIN
  SELECT * INTO v_usuario FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v_usuario.usuario_id IS NULL OR v_usuario.empresa_id IS NULL
     OR v_usuario.perfil NOT IN ('admin','administrador') THEN
    RETURN jsonb_build_object('sucesso',false,'erro','Acesso negado');
  END IF;
  IF p_competencia IS NULL OR p_competencia !~ '^2026-(0[1-9]|1[0-2])$' THEN
    RETURN jsonb_build_object('sucesso',false,'erro','Competência inválida; a primeira versão cobre somente 2026');
  END IF;
  IF p_funcionario_id IS NULL OR p_salario_base IS NULL OR p_salario_base<=0
     OR p_dependentes_irrf IS NULL OR p_dependentes_irrf NOT BETWEEN 0 AND 30
     OR p_outros_vinculos IS NULL OR p_outros_vinculos NOT IN ('nao','sim')
     OR p_outras_fontes_rendimento IS NULL OR p_outras_fontes_rendimento NOT IN ('nao','sim')
     OR p_pensao_alimenticia IS NULL OR p_pensao_alimenticia<0
     OR p_pensao_confirmada IS DISTINCT FROM true
     OR p_declaracao_confirmada IS DISTINCT FROM true THEN
    RETURN jsonb_build_object('sucesso',false,'erro','Confirme salário, dependentes, outros vínculos/rendimentos e pensão desta competência antes de salvar');
  END IF;
  v_competencia := to_date(p_competencia||'-01','YYYY-MM-DD');
  SELECT f.id,f.empresa_id,f.nome,f.salario,f.salario_periodo,f.tipo_vinculo,f.registrado,f.ativo,
    f.data_admissao,f.data_saida,f.data_demissao
  INTO v_funcionario
  FROM public.funcionarios f
  WHERE f.id=p_funcionario_id AND f.empresa_id=v_usuario.empresa_id
    AND f.tipo_vinculo='formal' AND f.registrado=true AND coalesce(f.ativo,false)=true
    AND f.data_admissao<=((v_competencia + interval '1 month - 1 day')::date)
    AND (coalesce(f.data_saida,f.data_demissao) IS NULL OR coalesce(f.data_saida,f.data_demissao)>=v_competencia)
  LIMIT 1;
  IF v_funcionario.id IS NULL THEN
    RETURN jsonb_build_object('sucesso',false,'erro','Funcionário CLT não localizado nesta empresa/competência');
  END IF;
  IF v_funcionario.salario_periodo IS DISTINCT FROM 'Mês'
     OR round(coalesce(v_funcionario.salario,0),2) IS DISTINCT FROM round(p_salario_base,2) THEN
    RETURN jsonb_build_object('sucesso',false,'erro','O salário informado diverge do cadastro vigente. Corrija e confira a ficha salarial antes de simular');
  END IF;

  INSERT INTO public.rh_folha_dados_competencia(
    empresa_id,funcionario_id,competencia,salario_base,dependentes_irrf,outros_vinculos,
    outras_fontes_rendimento,pensao_alimenticia,pensao_confirmada,declaracao_confirmada,
    confirmado_por,confirmado_em,updated_at
  ) VALUES (
    v_usuario.empresa_id,p_funcionario_id,v_competencia,round(p_salario_base,2),p_dependentes_irrf,
    p_outros_vinculos,p_outras_fontes_rendimento,round(p_pensao_alimenticia,2),true,true,
    v_usuario.usuario_id,now(),now()
  )
  ON CONFLICT (empresa_id,funcionario_id,competencia) DO UPDATE SET
    salario_base=EXCLUDED.salario_base,dependentes_irrf=EXCLUDED.dependentes_irrf,
    outros_vinculos=EXCLUDED.outros_vinculos,outras_fontes_rendimento=EXCLUDED.outras_fontes_rendimento,
    pensao_alimenticia=EXCLUDED.pensao_alimenticia,pensao_confirmada=true,
    declaracao_confirmada=true,confirmado_por=EXCLUDED.confirmado_por,
    confirmado_em=now(),updated_at=now();

  INSERT INTO public.auditoria_acoes(usuario_id,acao,entidade,entidade_id,detalhes)
  VALUES (v_usuario.usuario_id,'salvou_dados_folha_competencia','rh_folha_dados_competencia',p_funcionario_id,
    jsonb_build_object('competencia',p_competencia,'dependentes_irrf',p_dependentes_irrf,
      'outros_vinculos',p_outros_vinculos,'outras_fontes_rendimento',p_outras_fontes_rendimento,
      'pensao_alimenticia',round(p_pensao_alimenticia,2),'declaracao_confirmada',true));

  RETURN jsonb_build_object('sucesso',true,'funcionario_id',p_funcionario_id,'competencia',p_competencia,
    'mensagem','Dados da competência salvos para simulação interna; nenhum pagamento foi gerado');
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_admin_folha_simular_clt(p_token text,p_competencia text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','extensions'
AS $function$
DECLARE
  v_usuario record;
  v_competencia date;
  v_preview jsonb;
  v_fechamento_id uuid;
  v_rows jsonb := '[]'::jsonb;
  v_itens integer := 0;
  v_prontos integer := 0;
  v_pendentes integer := 0;
  v_total_inss numeric := 0;
  v_total_irrf numeric := 0;
  v_total_liquido numeric := 0;
  v_geral_completo boolean := true;
  r record;
  v_bloqueios jsonb;
  v_remuneracao numeric;
  v_inss numeric;
  v_irrf jsonb;
  v_item jsonb;
  v_tem_lancamento boolean;
BEGIN
  SELECT * INTO v_usuario FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v_usuario.usuario_id IS NULL OR v_usuario.empresa_id IS NULL
     OR v_usuario.perfil NOT IN ('admin','administrador') THEN
    RETURN jsonb_build_object('sucesso',false,'erro','Acesso negado');
  END IF;
  IF p_competencia IS NULL OR p_competencia !~ '^2026-(0[1-9]|1[0-2])$' THEN
    RETURN jsonb_build_object('sucesso',false,'erro','A simulação inicial está disponível somente para competências de 2026, no formato AAAA-MM');
  END IF;
  v_competencia := to_date(p_competencia||'-01','YYYY-MM-DD');
  v_preview := public.app_admin_visualizar_fechamento(p_token,p_competencia);
  IF coalesce((v_preview->>'sucesso')::boolean,false) IS NOT TRUE THEN
    RETURN jsonb_build_object('sucesso',true,'competencia',p_competencia,'status','bloqueada',
      'bloqueio_geral',coalesce(v_preview->>'erro','Prévia 44h válida não encontrada; gere ou atualize a prévia antes de simular'),
      'itens','[]'::jsonb,'totais',null,'pagamento_gerado',false);
  END IF;
  IF v_preview->'regras'->>'versao_regra' IS DISTINCT FROM 'v5_44h_dsr_semanal' THEN
    RETURN jsonb_build_object('sucesso',true,'competencia',p_competencia,'status','bloqueada',
      'bloqueio_geral','A prévia não usa a regra CLT 44h/DSR vigente; recalcule a prévia mensal',
      'itens','[]'::jsonb,'totais',null,'pagamento_gerado',false);
  END IF;
  SELECT fm.id INTO v_fechamento_id FROM public.fechamentos_mensais fm
  WHERE fm.empresa_id=v_usuario.empresa_id AND fm.competencia=p_competencia
    AND fm.status IN ('calculado','fechado')
  ORDER BY fm.created_at DESC LIMIT 1;
  IF v_fechamento_id IS NULL THEN
    RETURN jsonb_build_object('sucesso',true,'competencia',p_competencia,'status','bloqueada',
      'bloqueio_geral','Prévia de fechamento 44h ainda não está calculada',
      'itens','[]'::jsonb,'totais',null,'pagamento_gerado',false);
  END IF;

  FOR r IN
    SELECT f.id AS funcionario_id,f.nome,f.cargo,f.salario,f.salario_periodo,
      f.tipo_vinculo,f.registrado,f.ativo,f.data_admissao,
      coalesce(f.data_saida,f.data_demissao) AS data_fim_vinculo,
      d.funcionario_id AS dados_id,d.salario_base,d.dependentes_irrf,d.outros_vinculos,
      d.outras_fontes_rendimento,d.pensao_alimenticia,d.pensao_confirmada,d.declaracao_confirmada,
      ff.id AS fechamento_linha_id,ff.faltas,ff.faltas_injustificadas,ff.faltas_justificadas,
      ff.atrasos_minutos,ff.dias_ferias,ff.dias_afastamento,ff.horas_extras_50_valor,
      ff.horas_extras_100_valor,ff.dsr_desconto,ff.dsr_semanas_perdidas,ff.dsr_pendencias,
      ff.salario_pendente,ff.carga_semanal_minutos,ff.jornada_nome
    FROM public.funcionarios f
    LEFT JOIN public.rh_folha_dados_competencia d
      ON d.empresa_id=f.empresa_id AND d.funcionario_id=f.id AND d.competencia=v_competencia
    LEFT JOIN public.fechamento_funcionarios ff
      ON ff.funcionario_id=f.id AND ff.fechamento_id=v_fechamento_id
    WHERE f.empresa_id=v_usuario.empresa_id AND f.tipo_vinculo='formal'
      AND f.registrado=true AND coalesce(f.ativo,false)=true
      AND f.data_admissao IS NOT NULL
      AND f.data_admissao<=(v_competencia + interval '1 month - 1 day')::date
      AND (coalesce(f.data_saida,f.data_demissao) IS NULL
        OR coalesce(f.data_saida,f.data_demissao)>=v_competencia)
    ORDER BY f.nome
    LIMIT 1000
  LOOP
    v_itens := v_itens+1;
    v_bloqueios := '[]'::jsonb;
    v_tem_lancamento := EXISTS (
      SELECT 1 FROM public.rh_beneficios_lancamentos b
      WHERE b.empresa_id=v_usuario.empresa_id AND b.funcionario_id=r.funcionario_id
        AND b.competencia=v_competencia
        AND lower(coalesce(b.status,'')) NOT IN ('cancelado','anulado','arquivado','rejeitado')
      LIMIT 1
    ) OR EXISTS (
      SELECT 1 FROM public.rh_descontos_lancamentos d
      WHERE d.empresa_id=v_usuario.empresa_id AND d.funcionario_id=r.funcionario_id
        AND d.competencia=v_competencia
        AND lower(coalesce(d.status,'')) NOT IN ('cancelado','anulado','arquivado','rejeitado')
      LIMIT 1
    );

    IF r.dados_id IS NULL THEN
      v_bloqueios := v_bloqueios || jsonb_build_array('Dados fiscais da competência ainda não foram confirmados');
    ELSE
      IF r.salario_base IS DISTINCT FROM round(coalesce(r.salario,0),2)
         OR r.salario_periodo IS DISTINCT FROM 'Mês' THEN
        v_bloqueios := v_bloqueios || jsonb_build_array('Salário mensal diverge do cadastro vigente; confira a ficha antes de simular');
      END IF;
      IF r.dependentes_irrf IS NULL THEN
        v_bloqueios := v_bloqueios || jsonb_build_array('Número de dependentes de IRRF não confirmado');
      END IF;
      IF r.outros_vinculos IS DISTINCT FROM 'nao' THEN
        v_bloqueios := v_bloqueios || jsonb_build_array('Há outro vínculo ou ele não foi descartado; cálculo de múltiplas fontes ainda não está habilitado');
      END IF;
      IF r.outras_fontes_rendimento IS DISTINCT FROM 'nao' THEN
        v_bloqueios := v_bloqueios || jsonb_build_array('Há outra fonte de rendimento ou ela não foi descartada; consolidação tributária ainda não está habilitada');
      END IF;
      IF coalesce(r.pensao_confirmada,false) IS NOT TRUE
         OR coalesce(r.declaracao_confirmada,false) IS NOT TRUE
         OR r.pensao_alimenticia IS NULL THEN
        v_bloqueios := v_bloqueios || jsonb_build_array('Confirmação da pensão alimentícia e da declaração individual incompleta');
      END IF;
    END IF;

    IF r.fechamento_linha_id IS NULL THEN
      v_bloqueios := v_bloqueios || jsonb_build_array('A pessoa não possui linha válida na prévia 44h desta competência');
    ELSE
      IF r.data_admissao>v_competencia OR
         (r.data_fim_vinculo IS NOT NULL AND r.data_fim_vinculo<=(v_competencia + interval '1 month - 1 day')::date) THEN
        v_bloqueios := v_bloqueios || jsonb_build_array('Admissão ou desligamento parcial no mês: proporcionalização ainda não está integrada');
      END IF;
      IF coalesce(r.dsr_pendencias,0)>0 OR coalesce(r.salario_pendente,true) THEN
        v_bloqueios := v_bloqueios || jsonb_build_array('A prévia de ponto/DSR ou o salário contém pendências');
      END IF;
      IF coalesce(r.carga_semanal_minutos,0)<>2640 THEN
        v_bloqueios := v_bloqueios || jsonb_build_array('A jornada efetiva não é o modelo semanal de 44h desta fase');
      END IF;
      IF coalesce(r.faltas_injustificadas,0)>0 THEN
        v_bloqueios := v_bloqueios || jsonb_build_array('Há falta injustificada: o desconto direto do dia ainda não está integrado à simulação');
      END IF;
      IF coalesce(r.faltas_justificadas,0)>0 OR coalesce(r.atrasos_minutos,0)>0
         OR coalesce(r.dias_ferias,0)>0 OR coalesce(r.dias_afastamento,0)>0 THEN
        v_bloqueios := v_bloqueios || jsonb_build_array('Há falta justificada, atraso, férias ou afastamento que requer cálculo específico ainda não integrado');
      END IF;
    END IF;
    IF v_tem_lancamento THEN
      v_bloqueios := v_bloqueios || jsonb_build_array('Há benefício/desconto nesta competência; incidências e autorização ainda precisam ser classificados antes de compor tributos ou líquido');
    END IF;
    IF coalesce(r.salario,0)<=0 OR r.salario_periodo IS DISTINCT FROM 'Mês' THEN
      v_bloqueios := v_bloqueios || jsonb_build_array('Salário mensal válido ausente');
    END IF;

    v_item := jsonb_build_object(
      'funcionario_id',r.funcionario_id,'nome',r.nome,'cargo',r.cargo,
      'jornada_nome',r.jornada_nome,'carga_semanal_minutos',r.carga_semanal_minutos,
      'dsr_desconto',coalesce(r.dsr_desconto,0),
      'dsr_semanas_perdidas',coalesce(r.dsr_semanas_perdidas,0),
      'horas_extras_50_valor',coalesce(r.horas_extras_50_valor,0),
      'horas_extras_100_valor',coalesce(r.horas_extras_100_valor,0),
      'status',CASE WHEN jsonb_array_length(v_bloqueios)=0 THEN 'simulado' ELSE 'pendente' END,
      'bloqueios',v_bloqueios
    );

    IF jsonb_array_length(v_bloqueios)=0 THEN
      v_remuneracao := round(r.salario_base + coalesce(r.horas_extras_50_valor,0)
        + coalesce(r.horas_extras_100_valor,0)-coalesce(r.dsr_desconto,0),2);
      IF v_remuneracao<1621.00 THEN
        v_bloqueios := v_bloqueios || jsonb_build_array('Base previdenciária abaixo do piso: complementação proporcional não está implementada');
        v_item := jsonb_set(v_item,'{status}',to_jsonb('pendente'::text),true);
        v_item := jsonb_set(v_item,'{bloqueios}',v_bloqueios,true);
      ELSE
        v_inss := public.app_folha_2026_calcular_inss(v_remuneracao);
        v_irrf := public.app_folha_2026_calcular_irrf(v_remuneracao,v_inss,
          r.dependentes_irrf,coalesce(r.pensao_alimenticia,0));
        v_item := v_item || jsonb_build_object(
          'remuneracao_tributavel_estimada',v_remuneracao,
          'base_inss_estimada',least(v_remuneracao,8475.55),
          'inss_estimado',v_inss,
          'memoria_irrf',v_irrf,
          'irrf_estimado',(v_irrf->>'irrf')::numeric,
          'liquido_estimado',round(v_remuneracao-v_inss-(v_irrf->>'irrf')::numeric,2)
        );
        v_prontos := v_prontos+1;
        v_total_inss := v_total_inss+v_inss;
        v_total_irrf := v_total_irrf+(v_irrf->>'irrf')::numeric;
        v_total_liquido := v_total_liquido+round(v_remuneracao-v_inss-(v_irrf->>'irrf')::numeric,2);
      END IF;
    END IF;
    IF v_item->>'status'='pendente' THEN
      v_pendentes := v_pendentes+1;
      v_geral_completo := false;
    END IF;
    v_rows := v_rows || jsonb_build_array(v_item);
  END LOOP;

  RETURN jsonb_build_object(
    'sucesso',true,'competencia',p_competencia,'status',
      CASE WHEN v_itens>0 AND v_geral_completo THEN 'simulacao_preliminar_completa' ELSE 'simulacao_com_pendencias' END,
    'versao_regra','CLT_MENSAL_2026_PRELIMINAR_V1','source_fingerprint',v_preview->>'source_fingerprint',
    'quantidade_funcionarios',v_itens,'quantidade_prontos',v_prontos,'quantidade_pendentes',v_pendentes,
    'itens',v_rows,
    'totais',CASE WHEN v_itens>0 AND v_geral_completo THEN jsonb_build_object(
      'inss_estimado',round(v_total_inss,2),'irrf_estimado',round(v_total_irrf,2),
      'liquido_estimado',round(v_total_liquido,2)) ELSE NULL END,
    'pagamento_gerado',false,
    'aviso','SIMULAÇÃO PRELIMINAR. Não é contracheque, folha oficial, valor de pagamento, recolhimento ou transmissão. Sem benefícios/descontos, faltas/atrasos, múltiplas fontes, férias/afastamentos ou complemento previdenciário. Arredondamento e incidências devem ser homologados pela contabilidade.',
    'fontes',jsonb_build_array(
      'https://www.gov.br/inss/pt-br/direitos-e-deveres/inscricao-e-contribuicao/tabela-de-contribuicao-mensal',
      'https://www.gov.br/previdencia/pt-br/assuntos/rpps/documentos/PortariaInterministerialMPSMF13de9dejaneirode2026.pdf',
      'https://www.gov.br/receitafederal/pt-br/assuntos/meu-imposto-de-renda/tabelas/2026',
      'https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2025/lei/l15270.htm'
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.app_folha_2026_calcular_inss(numeric) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.app_folha_2026_calcular_irrf(numeric,numeric,integer,numeric) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.app_admin_folha_dados_listar(text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_admin_folha_dados_salvar(text,uuid,text,numeric,integer,text,text,numeric,boolean,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_admin_folha_simular_clt(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_admin_folha_dados_listar(text,text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_folha_dados_salvar(text,uuid,text,numeric,integer,text,text,numeric,boolean,boolean) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.app_admin_folha_simular_clt(text,text) TO anon,authenticated;

COMMIT;
