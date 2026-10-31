begin;

create table if not exists public.rh_ferias_programacao_historica (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  codigo_empregado integer not null,
  nome_relatorio text not null,
  funcionario_id uuid references public.funcionarios(id) on delete set null,
  data_admissao date,
  vencimento_ferias date,
  ferias_vencidas integer not null default 0,
  ferias_programadas text,
  aquisitivo_inicio date not null,
  aquisitivo_fim date not null,
  dias_direito numeric(8,2),
  dias_gozados_relatorio numeric(8,2),
  dias_restantes_relatorio numeric(8,2),
  limite_gozo date,
  dias_afastamento text,
  dias_faltas text,
  fonte_emissao date not null default date '2026-10-19',
  fonte_nome text not null default 'Programação de Férias.pdf',
  created_at timestamptz not null default now(),
  unique (empresa_id, codigo_empregado, aquisitivo_inicio, aquisitivo_fim)
);

with dados(codigo, nome, admissao, vencimento, vencidas, programadas, aquis_inicio, aquis_fim, direito, gozados, restantes, limite, afastamento, faltas) as (
  values
    (9, 'ALESSANDRA DE ALMEIDA GONÇALVES', '2024-01-03'::date, '2027-01-02'::date, 0, '10/12', '2026-01-03'::date, '2027-01-02'::date, 25, 0, 30, '2027-12-04'::date, '-', '-'),
    (18, 'ANA PAULA ALVES DA SILVA', '2025-06-02'::date, '2027-06-01'::date, 0, '05/12', '2026-06-02'::date, '2027-06-01'::date, 7.5, 0, 18, '2028-05-15'::date, '-', '23'),
    (22, 'CLEIDE SANTIAGO DA SILVA', '2025-11-14'::date, '2026-11-13'::date, 0, '11/12', '2025-11-14'::date, '2026-11-13'::date, 27.5, 0, 30, '2027-10-15'::date, '60', '-'),
    (1, 'EDNA APARECIDA PEREIRA RODRIGUES', '2021-01-04'::date, '2027-01-03'::date, 0, '10/12', '2026-01-04'::date, '2027-01-03'::date, 25, 0, 30, '2027-12-05'::date, '-', '-'),
    (25, 'GRAZIELE APARECIDA DA SILVA', '2026-02-16'::date, '2027-02-15'::date, 0, '08/12', '2026-02-16'::date, '2027-02-15'::date, 12, 0, 18, '2028-01-29'::date, '-', '20'),
    (6, 'ILENA CRISTINA ANDRADE VASCONCELOS', '2023-07-03'::date, '2026-07-02'::date, 1, '04/12', '2025-07-03'::date, '2026-07-02'::date, 30, 0, 30, '2027-06-03'::date, '-', '-'),
    (6, 'ILENA CRISTINA ANDRADE VASCONCELOS', '2023-07-03'::date, '2026-07-02'::date, 1, '04/12', '2026-07-03'::date, '2027-07-02'::date, 10, 0, 30, '2028-06-03'::date, '-', '-'),
    (8, 'JOYCE CAROLINA OLIVEIRA ANTUNES', '2023-09-01'::date, '2026-08-31'::date, 1, '02/12', '2025-09-01'::date, '2026-08-31'::date, 24, 0, 24, '2027-08-08'::date, '-', '13'),
    (8, 'JOYCE CAROLINA OLIVEIRA ANTUNES', '2023-09-01'::date, '2026-08-31'::date, 1, '02/12', '2026-09-01'::date, '2027-08-31'::date, 5, 0, 30, '2028-08-02'::date, '-', '-'),
    (21, 'JOYCE CAROLINA DA SILVA FERREIRA', '2025-08-20'::date, '2026-08-19'::date, 1, '02/12', '2025-08-20'::date, '2026-08-19'::date, 30, 10, 20, '2027-07-31'::date, '-', '4'),
    (21, 'JOYCE CAROLINA DA SILVA FERREIRA', '2025-08-20'::date, '2026-08-19'::date, 1, '02/12', '2026-08-20'::date, '2027-08-19'::date, 5, 0, 30, '2028-07-21'::date, '-', '-'),
    (14, 'KAUA HENRIQUE DE ANTONIO', '2025-02-01'::date, '2026-01-31'::date, 1, '09/12', '2025-02-01'::date, '2026-01-31'::date, 30, 18, 12, '2027-01-20'::date, '-', '-'),
    (14, 'KAUA HENRIQUE DE ANTONIO', '2025-02-01'::date, '2026-01-31'::date, 1, '09/12', '2026-02-01'::date, '2027-01-31'::date, 22.5, 0, 30, '2028-01-02'::date, '-', '-'),
    (5, 'LEONICE ISABEL PINHEIRO DE SOUZA', '2023-02-13'::date, '2026-02-12'::date, 1, '08/12', '2025-02-13'::date, '2026-02-12'::date, 24, 0, 24, '2027-01-20'::date, '-', '13'),
    (5, 'LEONICE ISABEL PINHEIRO DE SOUZA', '2023-02-13'::date, '2026-02-12'::date, 1, '08/12', '2026-02-13'::date, '2027-02-12'::date, 8, 0, 12, '2028-02-01'::date, '-', '28'),
    (15, 'LUCIMEIRE FRIDA BENETOLI', '2025-02-01'::date, '2026-01-31'::date, 1, '09/12', '2025-02-01'::date, '2026-01-31'::date, 30, 18, 12, '2027-01-20'::date, '-', '-'),
    (15, 'LUCIMEIRE FRIDA BENETOLI', '2025-02-01'::date, '2026-01-31'::date, 1, '09/12', '2026-02-01'::date, '2027-01-31'::date, 22.5, 0, 30, '2028-01-02'::date, '-', '-'),
    (10, 'MARCIA ANDREIA DOS SANTOS OLIVEIRA', '2024-01-03'::date, '2027-01-02'::date, 0, '10/12', '2026-01-03'::date, '2027-01-02'::date, 25, 0, 30, '2027-12-04'::date, '-', '1'),
    (20, 'MARIA CLISTINA NASCIMENTO MARIA', '2025-08-15'::date, '2026-08-14'::date, 1, '02/12', '2025-08-15'::date, '2026-08-14'::date, 30, 18, 12, '2027-08-03'::date, '-', '1'),
    (20, 'MARIA CLISTINA NASCIMENTO MARIA', '2025-08-15'::date, '2026-08-14'::date, 1, '02/12', '2026-08-15'::date, '2027-08-14'::date, 5, 0, 30, '2028-07-16'::date, '-', '-'),
    (26, 'MARIA EDUARDA PACHECO SIQUEIRA', '2026-07-10'::date, '2027-07-09'::date, 0, '03/12', '2026-07-10'::date, '2027-07-09'::date, 7.5, 0, 30, '2028-06-10'::date, '-', '-'),
    (27, 'MILENA LAURA ALVES DA SILVA CRAIBA', '2026-07-22'::date, '2027-07-21'::date, 0, '03/12', '2026-07-22'::date, '2027-07-21'::date, 7.5, 0, 30, '2028-06-22'::date, '-', '-'),
    (7, 'PAULO ROBERTO SOARES', '2023-08-01'::date, '2026-07-31'::date, 1, '03/12', '2025-08-01'::date, '2026-07-31'::date, 24, 0, 24, '2027-07-08'::date, '-', '8'),
    (7, 'PAULO ROBERTO SOARES', '2023-08-01'::date, '2026-07-31'::date, 1, '03/12', '2026-08-01'::date, '2027-07-31'::date, 7.5, 0, 30, '2028-07-02'::date, '-', '-'),
    (12, 'PRISCILA DUTRA TONDATO', '2024-06-01'::date, '2026-05-31'::date, 1, '05/12', '2025-06-01'::date, '2026-05-31'::date, 30, 16, 14, '2027-05-18'::date, '-', '-'),
    (12, 'PRISCILA DUTRA TONDATO', '2024-06-01'::date, '2026-05-31'::date, 1, '05/12', '2026-06-01'::date, '2027-05-31'::date, 12.5, 0, 30, '2028-05-02'::date, '-', '1'),
    (29, 'ROSANGELA ALVES GOUVEIA', '2026-09-21'::date, '2027-09-20'::date, 0, '01/12', '2026-09-21'::date, '2027-09-20'::date, 2.5, 0, 30, '2028-08-22'::date, '-', '-'),
    (3, 'ROSINEIDE GOMES DA SILVA PADOVAN', '2021-08-01'::date, '2026-07-31'::date, 1, '03/12', '2025-08-01'::date, '2026-07-31'::date, 30, 0, 30, '2027-07-02'::date, '45', '-'),
    (3, 'ROSINEIDE GOMES DA SILVA PADOVAN', '2021-08-01'::date, '2026-07-31'::date, 1, '03/12', '2026-08-01'::date, '2027-07-31'::date, 6, 0, 24, '2028-07-08'::date, '-', '6'),
    (11, 'RUTH LETICIA RODRIGUES DE ANTONIO', '2024-01-03'::date, '2027-01-02'::date, 0, '10/12', '2026-01-03'::date, '2027-01-02'::date, 25, 0, 30, '2027-12-04'::date, '-', '-'),
    (17, 'SILENE VICENTE DE SOUZA FERNANDES', '2025-05-02'::date, '2026-05-01'::date, 1, '06/12', '2025-05-02'::date, '2026-05-01'::date, 30, 18, 12, '2027-04-20'::date, '-', '-'),
    (17, 'SILENE VICENTE DE SOUZA FERNANDES', '2025-05-02'::date, '2026-05-01'::date, 1, '06/12', '2026-05-02'::date, '2027-05-01'::date, 15, 0, 30, '2028-04-02'::date, '-', '-'),
    (2, 'THAIS EMANUELLI FERNANDES DA SILVA', '2021-07-01'::date, '2026-06-30'::date, 1, '04/12', '2025-07-01'::date, '2026-06-30'::date, 30, 0, 30, '2027-06-01'::date, '-', '-'),
    (2, 'THAIS EMANUELLI FERNANDES DA SILVA', '2021-07-01'::date, '2026-06-30'::date, 1, '04/12', '2026-07-01'::date, '2027-06-30'::date, 10, 0, 30, '2028-06-01'::date, '-', '-')
), empresa as (select id from public.empresas where cnpj = '27.476.242/0001-02' limit 1)
insert into public.rh_ferias_programacao_historica (empresa_id, codigo_empregado, nome_relatorio, data_admissao, vencimento_ferias, ferias_vencidas, ferias_programadas, aquisitivo_inicio, aquisitivo_fim, dias_direito, dias_gozados_relatorio, dias_restantes_relatorio, limite_gozo, dias_afastamento, dias_faltas)
select empresa.id, d.codigo, d.nome, d.admissao, d.vencimento, d.vencidas, d.programadas, d.aquis_inicio, d.aquis_fim, d.direito, d.gozados, d.restantes, d.limite, d.afastamento, d.faltas
from dados d cross join empresa
on conflict (empresa_id, codigo_empregado, aquisitivo_inicio, aquisitivo_fim) do update set nome_relatorio=excluded.nome_relatorio, data_admissao=excluded.data_admissao, vencimento_ferias=excluded.vencimento_ferias, ferias_vencidas=excluded.ferias_vencidas, ferias_programadas=excluded.ferias_programadas, dias_direito=excluded.dias_direito, dias_gozados_relatorio=excluded.dias_gozados_relatorio, dias_restantes_relatorio=excluded.dias_restantes_relatorio, limite_gozo=excluded.limite_gozo, dias_afastamento=excluded.dias_afastamento, dias_faltas=excluded.dias_faltas;

update public.rh_ferias_programacao_historica h set funcionario_id = f.id
from public.funcionarios f
where h.funcionario_id is null
  and (upper(trim(f.nome)) = upper(trim(h.nome_relatorio))
    or (h.codigo_empregado = 27 and upper(trim(f.nome)) like 'MILLENA LAURA%')
    or (h.codigo_empregado = 6 and upper(trim(f.nome)) like 'ILENA CRISTINA%'));

create or replace function public.app_admin_listar_ferias_programacao_historica(p_token text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v record; v_rows jsonb;
begin
  select * into v from public.app_tenant_usuario(p_token) limit 1;
  if v.usuario_id is null or v.perfil not in ('admin','administrador') then return jsonb_build_object('sucesso',false,'erro','Acesso restrito ao administrador'); end if;
  with distinct_ferias as (
    select distinct on (r.funcionario_id, r.periodo_aquisitivo_inicio, r.periodo_aquisitivo_fim, r.inicio, r.fim) r.*
    from public.rh_ferias r where r.empresa_id = v.empresa_id
    order by r.funcionario_id, r.periodo_aquisitivo_inicio, r.periodo_aquisitivo_fim, r.inicio, r.fim, r.updated_at desc, r.created_at desc
  ), sistema as (
    select funcionario_id, periodo_aquisitivo_inicio, periodo_aquisitivo_fim,
      sum(coalesce(dias_gozo, case when inicio is not null and fim is not null then (fim - inicio + 1) else 0 end))::numeric as dias_gozados_sistema,
      count(*)::int as periodos_sistema
    from distinct_ferias group by funcionario_id, periodo_aquisitivo_inicio, periodo_aquisitivo_fim
  )
  select coalesce(jsonb_agg(to_jsonb(x) order by x.nome_relatorio, x.aquisitivo_inicio), '[]'::jsonb) into v_rows
  from (
    select h.id, h.codigo_empregado, h.nome_relatorio, h.data_admissao, h.vencimento_ferias, h.ferias_vencidas, h.ferias_programadas, h.aquisitivo_inicio, h.aquisitivo_fim, h.dias_direito, h.dias_gozados_relatorio, h.dias_restantes_relatorio, h.limite_gozo, h.dias_afastamento, h.dias_faltas, h.fonte_emissao, h.fonte_nome,
      h.funcionario_id, f.nome as nome_sistema, f.data_admissao as data_admissao_sistema,
      coalesce(s.dias_gozados_sistema,0) as dias_gozados_sistema, coalesce(s.periodos_sistema,0) as periodos_sistema,
      greatest(coalesce(h.dias_direito,0) - coalesce(s.dias_gozados_sistema,0),0) as dias_disponiveis,
      greatest(coalesce(s.dias_gozados_sistema,0) - coalesce(h.dias_direito,0),0) as dias_excedentes,
      (select count(*)::int from public.rh_ferias r join public.rh_ferias_documentos d on d.ferias_id = r.id and d.empresa_id = r.empresa_id where r.empresa_id=v.empresa_id and r.funcionario_id=h.funcionario_id and r.periodo_aquisitivo_inicio=h.aquisitivo_inicio and r.periodo_aquisitivo_fim=h.aquisitivo_fim and d.tipo='aviso' and d.storage_path is not null) as avisos_sistema,
      (select count(*)::int from public.rh_ferias r join public.rh_ferias_documentos d on d.ferias_id = r.id and d.empresa_id = r.empresa_id where r.empresa_id=v.empresa_id and r.funcionario_id=h.funcionario_id and r.periodo_aquisitivo_inicio=h.aquisitivo_inicio and r.periodo_aquisitivo_fim=h.aquisitivo_fim and d.tipo='recibo' and d.storage_path is not null) as recibos_sistema,
      case when h.funcionario_id is null then 'sem_vinculo' when coalesce(s.dias_gozados_sistema,0) > coalesce(h.dias_direito,0) then 'dias_excedentes' when coalesce(s.periodos_sistema,0)=0 then 'sem_ferias_lancadas' else 'conferido' end as situacao_confronto
    from public.rh_ferias_programacao_historica h left join public.funcionarios f on f.id=h.funcionario_id left join sistema s on s.funcionario_id=h.funcionario_id and s.periodo_aquisitivo_inicio=h.aquisitivo_inicio and s.periodo_aquisitivo_fim=h.aquisitivo_fim
    where h.empresa_id=v.empresa_id limit 100
  ) x;
  return jsonb_build_object('sucesso',true,'programacao',v_rows,'fonte',jsonb_build_object('nome','Programação de Férias.pdf','emissao','2026-10-19','total_empregados',22));
end; $$;

comment on function public.app_admin_listar_ferias_programacao_historica(text) is 'Programação histórica estruturada no Supabase a partir do relatório emitido em 19/10/2026; confronta períodos e dias com o sistema atual.';
commit;
