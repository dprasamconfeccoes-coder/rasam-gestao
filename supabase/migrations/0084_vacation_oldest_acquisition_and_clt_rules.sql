-- Seleciona o período aquisitivo mais antigo ainda com saldo e aplica as regras
-- essenciais do fracionamento previsto no art. 134, §1º, da CLT.
CREATE OR REPLACE FUNCTION public.app_admin_criar_ferias(
  p_token text,
  p_funcionario_id uuid,
  p_periodo_aquisitivo_inicio date,
  p_periodo_aquisitivo_fim date,
  p_inicio date,
  p_fim date,
  p_status text DEFAULT 'agendada',
  p_observacoes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v record;
  v_id uuid;
  v_status text := coalesce(nullif(trim(p_status), ''), 'agendada');
  v_aquisitivo record;
  v_dias integer;
  v_usados integer;
  v_periodos integer;
  v_tem_periodo_longo boolean;
BEGIN
  SELECT * INTO v FROM public.app_tenant_usuario(p_token) LIMIT 1;
  IF v.usuario_id IS NULL OR v.perfil NOT IN ('admin', 'administrador') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Acesso negado');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.funcionarios f WHERE f.id = p_funcionario_id AND f.empresa_id = v.empresa_id) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Funcionário não encontrado na empresa');
  END IF;
  IF p_inicio IS NULL OR p_fim IS NULL OR p_inicio > p_fim THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Informe o início das férias e a quantidade de dias válida');
  END IF;
  v_dias := (p_fim - p_inicio) + 1;
  IF v_dias < 5 OR v_dias > 30 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Cada período de férias deve ter entre 5 e 30 dias corridos');
  END IF;
  IF v_status NOT IN ('agendada', 'em_gozo', 'concluida', 'cancelada') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Status de férias inválido');
  END IF;

  -- A decisão do período não fica sob controle do navegador: o banco escolhe
  -- o período aquisitivo mais antigo que ainda possui saldo.
  SELECT x.periodo_aquisitivo_inicio, x.periodo_aquisitivo_fim, x.dias_usados
    INTO v_aquisitivo
  FROM (
    SELECT r.periodo_aquisitivo_inicio, r.periodo_aquisitivo_fim,
           coalesce(sum(CASE WHEN r.inicio IS NOT NULL AND r.fim IS NOT NULL THEN (r.fim - r.inicio) + 1 ELSE 0 END), 0)::integer AS dias_usados
      FROM public.rh_ferias r
     WHERE r.empresa_id = v.empresa_id
       AND r.funcionario_id = p_funcionario_id
       AND r.status <> 'cancelada'
     GROUP BY r.periodo_aquisitivo_inicio, r.periodo_aquisitivo_fim
     HAVING coalesce(sum(CASE WHEN r.inicio IS NOT NULL AND r.fim IS NOT NULL THEN (r.fim - r.inicio) + 1 ELSE 0 END), 0) < 30
     ORDER BY r.periodo_aquisitivo_inicio, r.periodo_aquisitivo_fim
     LIMIT 1
  ) x;
  IF v_aquisitivo.periodo_aquisitivo_inicio IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Nenhum período aquisitivo com saldo disponível foi encontrado para este funcionário');
  END IF;

  SELECT count(*)::integer,
         coalesce(sum((r.fim - r.inicio) + 1), 0)::integer,
         coalesce(bool_or((r.fim - r.inicio) + 1 >= 14), false)
    INTO v_periodos, v_usados, v_tem_periodo_longo
    FROM public.rh_ferias r
   WHERE r.empresa_id = v.empresa_id
     AND r.funcionario_id = p_funcionario_id
     AND r.status <> 'cancelada'
     AND r.periodo_aquisitivo_inicio = v_aquisitivo.periodo_aquisitivo_inicio
     AND r.periodo_aquisitivo_fim = v_aquisitivo.periodo_aquisitivo_fim;
  IF v_periodos >= 3 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'A CLT permite no máximo três períodos de gozo para o mesmo período aquisitivo');
  END IF;
  IF v_usados + v_dias > 30 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', format('O período aquisitivo selecionado tem apenas %s dia(s) disponível(eis)', 30 - v_usados));
  END IF;
  IF NOT v_tem_periodo_longo AND v_periodos = 0 AND v_dias < 14 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'No fracionamento, um dos períodos deve ter no mínimo 14 dias corridos; lance primeiro um período de 14 dias ou mais');
  END IF;
  IF v_status <> 'cancelada' AND EXISTS (
    SELECT 1 FROM public.rh_ferias r
     WHERE r.empresa_id = v.empresa_id
       AND r.funcionario_id = p_funcionario_id
       AND r.status <> 'cancelada'
       AND r.inicio <= p_fim AND r.fim >= p_inicio
  ) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Já existe férias sobrepostas para este funcionário');
  END IF;

  INSERT INTO public.rh_ferias(empresa_id, funcionario_id, periodo_aquisitivo_inicio, periodo_aquisitivo_fim, inicio, fim, status, observacoes)
  VALUES (v.empresa_id, p_funcionario_id, v_aquisitivo.periodo_aquisitivo_inicio, v_aquisitivo.periodo_aquisitivo_fim, p_inicio, p_fim, v_status, nullif(trim(p_observacoes), ''))
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('sucesso', true, 'id', v_id, 'periodo_aquisitivo_inicio', v_aquisitivo.periodo_aquisitivo_inicio, 'periodo_aquisitivo_fim', v_aquisitivo.periodo_aquisitivo_fim);
END;
$$;
