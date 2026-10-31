begin;
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
)
insert into public.rh_ferias_programacao_historica (empresa_id,codigo_empregado,nome_relatorio,data_admissao,vencimento_ferias,ferias_vencidas,ferias_programadas,aquisitivo_inicio,aquisitivo_fim,dias_direito,dias_gozados_relatorio,dias_restantes_relatorio,limite_gozo,dias_afastamento,dias_faltas)
select empresa.id,d.codigo,d.nome,d.admissao,d.vencimento,d.vencidas,d.programadas,d.aquis_inicio,d.aquis_fim,d.direito,d.gozados,d.restantes,d.limite,d.afastamento,d.faltas from dados d cross join (select id from public.empresas where nome_fantasia='RF Gestão' limit 1) empresa
  on conflict (empresa_id,codigo_empregado,aquisitivo_inicio,aquisitivo_fim) do update set nome_relatorio=excluded.nome_relatorio;
update public.rh_ferias_programacao_historica h set funcionario_id=f.id from public.funcionarios f where h.funcionario_id is null and (upper(trim(f.nome))=upper(trim(h.nome_relatorio)) or (h.codigo_empregado=27 and upper(trim(f.nome)) like 'MILLENA LAURA%') or (h.codigo_empregado=6 and upper(trim(f.nome)) like 'ILENA CRISTINA%'));
commit;
