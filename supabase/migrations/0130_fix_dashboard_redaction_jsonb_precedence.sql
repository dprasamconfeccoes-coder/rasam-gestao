-- Corrige a precedência de -> e - em expressões JSONB.
-- Sem os parênteses, o PostgreSQL tentava converter a chave "indicadores"
-- em JSON, quebrando o dashboard de perfis não administrativos.
create or replace function public.app_dashboard_redact_non_admin_i112(p_result jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_result jsonb := coalesce(p_result, '{}'::jsonb);
  v_indicadores jsonb;
  v_comparativos jsonb;
  v_inteligencia jsonb;
  v_pendencias jsonb;
  v_relatorios jsonb;
  v_alertas jsonb;
  v_agenda jsonb;
  v_item jsonb;
begin
  if jsonb_typeof(v_result) <> 'object' then return v_result; end if;

  v_result := v_result - array['financeiro','dividas','divida','acordos','acordo']::text[];

  if v_result ? 'indicadores' and jsonb_typeof(v_result->'indicadores') = 'object' then
    v_indicadores := (v_result->'indicadores') - array[
      'financeiro','dividas','divida','acordos','acordo','contas_pendentes','saldo_dividas','dividas_saldo',
      'receitas_realizadas','despesas_realizadas','resultado_realizado','receitas_a_receber','despesas_a_pagar',
      'despesas_vencidas','receitas_pendentes','receitas_recebidas','receitas_ordens_previstas',
      'ordens_aguardando_pagamento','recebiveis_com_vencimento','pagamentos_com_vencimento',
      'compromissos_recorrentes','recorrencias_ativas','saldo_projetado'
    ]::text[];
    v_result := jsonb_set(v_result, '{indicadores}', v_indicadores, true);
  end if;

  if v_result ? 'comparativos' and jsonb_typeof(v_result->'comparativos') = 'object' then
    v_comparativos := (v_result->'comparativos') - array[
      'financeiro','dividas','divida','acordos','acordo','receitas_realizadas','despesas_realizadas',
      'receitas_pendentes','despesas_pendentes','receitas_a_receber','despesas_a_pagar','contas_pendentes','saldo_dividas'
    ]::text[];
    v_result := jsonb_set(v_result, '{comparativos}', v_comparativos, true);
  end if;

  if v_result ? 'alertas' and jsonb_typeof(v_result->'alertas') = 'array' then
    select coalesce(jsonb_agg(item), '[]'::jsonb) into v_alertas
    from jsonb_array_elements(v_result->'alertas') as alert_items(item)
    where lower(coalesce(item->>'destino', item->>'modulo', '')) not in ('financeiro','dividas','divida','acordos','acordo')
      and lower(coalesce(item->>'tipo', '')) not in ('financeiro','dividas','divida','acordos','acordo');
    v_result := jsonb_set(v_result, '{alertas}', coalesce(v_alertas, '[]'::jsonb), true);
  end if;

  if v_result ? 'inteligencia' and jsonb_typeof(v_result->'inteligencia') = 'object' then
    v_inteligencia := (v_result->'inteligencia') - array['financeiro','dividas','divida','acordos','acordo']::text[];
    if v_inteligencia ? 'agenda' and jsonb_typeof(v_inteligencia->'agenda') = 'array' then
      select coalesce(jsonb_agg(item), '[]'::jsonb) into v_agenda
      from jsonb_array_elements(v_inteligencia->'agenda') as agenda_items(item)
      where lower(coalesce(item->>'destino', item->>'modulo', '')) not in ('financeiro','dividas','divida','acordos','acordo')
        and lower(coalesce(item->>'tipo', '')) not in ('financeiro','dividas','divida','acordos','acordo');
      v_inteligencia := jsonb_set(v_inteligencia, '{agenda}', coalesce(v_agenda, '[]'::jsonb), true);
    end if;
    if v_inteligencia ? 'pendencias_area' and jsonb_typeof(v_inteligencia->'pendencias_area') = 'object' then
      v_pendencias := (v_inteligencia->'pendencias_area') - array['financeiro','dividas','divida','acordos','acordo']::text[];
      v_inteligencia := jsonb_set(v_inteligencia, '{pendencias_area}', v_pendencias, true);
    end if;
    v_result := jsonb_set(v_result, '{inteligencia}', v_inteligencia, true);
  end if;

  if v_result ? 'relatorios' and jsonb_typeof(v_result->'relatorios') = 'object' then
    v_relatorios := (v_result->'relatorios') - array['financeiro','dividas','divida','acordos','acordo']::text[];
    v_result := jsonb_set(v_result, '{relatorios}', v_relatorios, true);
  elsif v_result ? 'relatorios' and jsonb_typeof(v_result->'relatorios') = 'array' then
    select coalesce(jsonb_agg(item), '[]'::jsonb) into v_relatorios
    from jsonb_array_elements(v_result->'relatorios') as report_items(item)
    where lower(coalesce(item->>'tipo', item->>'relatorio', '')) not in ('financeiro','dividas','divida','acordos','acordo');
    v_result := jsonb_set(v_result, '{relatorios}', coalesce(v_relatorios, '[]'::jsonb), true);
  end if;

  return v_result;
end;
$$;

grant execute on function public.app_dashboard_redact_non_admin_i112(jsonb) to anon, authenticated;
