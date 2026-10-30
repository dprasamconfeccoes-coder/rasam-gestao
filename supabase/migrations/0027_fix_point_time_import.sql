-- Corrige o regex de horário: PostgreSQL não interpreta \d como dígito POSIX.
-- Os horários originais continuam preservados em raw_data e podem ser recuperados.
update public.ponto_import_linhas
set entrada_1 = case when trim(coalesce(raw_data->>'entrada_1','')) ~ '^[0-9]{2}:[0-9]{2}' then substring(trim(raw_data->>'entrada_1') from '^[0-9]{2}:[0-9]{2}')::time else entrada_1 end,
    saida_1 = case when trim(coalesce(raw_data->>'saida_1','')) ~ '^[0-9]{2}:[0-9]{2}' then substring(trim(raw_data->>'saida_1') from '^[0-9]{2}:[0-9]{2}')::time else saida_1 end,
    entrada_2 = case when trim(coalesce(raw_data->>'entrada_2','')) ~ '^[0-9]{2}:[0-9]{2}' then substring(trim(raw_data->>'entrada_2') from '^[0-9]{2}:[0-9]{2}')::time else entrada_2 end,
    saida_2 = case when trim(coalesce(raw_data->>'saida_2','')) ~ '^[0-9]{2}:[0-9]{2}' then substring(trim(raw_data->>'saida_2') from '^[0-9]{2}:[0-9]{2}')::time else saida_2 end
where raw_data is not null;

update public.registros_ponto r
set entrada = l.entrada_1,
    saida_almoco = l.saida_1,
    volta_almoco = l.entrada_2,
    saida = l.saida_2,
    horas_trabalhadas = case when trim(coalesce(l.total_normais,'')) ~ '^[0-9]{1,2}:[0-9]{2}$' then make_interval(mins => split_part(trim(l.total_normais),':',1)::integer * 60 + split_part(trim(l.total_normais),':',2)::integer) else r.horas_trabalhadas end,
    status = case when nullif(trim(coalesce(l.dia_falta,'')),'') is not null then 'falta' else 'normal' end
from public.ponto_import_linhas l
join public.ponto_importacoes i on i.id=l.importacao_id and i.status='aplicada'
where r.funcionario_id=l.funcionario_id and r.data=l.data;

create or replace function public.app_importar_ponto(p_token text,p_tipo text,p_competencia text,p_arquivo_nome text,p_linhas jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare v_usuario record; v_importacao uuid; v_linha jsonb; v_funcionario_id uuid; v_total integer:=0; v_encontradas integer:=0; v_nao_encontradas integer:=0; v_cpfs jsonb:='[]'::jsonb; v_data date; v_cpf text; v_nome text; v_inconsistencia text; v_e1 time; v_s1 time; v_e2 time; v_s2 time;
begin
  select * into v_usuario from public.app_usuario_por_token(p_token) limit 1;
  if v_usuario.usuario_id is null or v_usuario.perfil not in ('admin','administrador','gestor') then return jsonb_build_object('sucesso',false,'erro','Acesso restrito ao painel administrativo'); end if;
  if p_tipo not in ('diario','mensal') or jsonb_typeof(p_linhas)<>'array' then return jsonb_build_object('sucesso',false,'erro','Arquivo de ponto inválido'); end if;
  insert into public.ponto_importacoes(tipo,competencia,arquivo_nome,imported_by,status) values(p_tipo,p_competencia,coalesce(nullif(trim(p_arquivo_nome),''),'ponto.csv'),v_usuario.usuario_id,'pendente') returning id into v_importacao;
  for v_linha in select value from jsonb_array_elements(p_linhas) loop
    v_total:=v_total+1; v_funcionario_id:=null; v_inconsistencia:=null; v_cpf:=regexp_replace(coalesce(v_linha->>'cpf',''),'[^0-9]','','g'); v_nome:=coalesce(nullif(trim(v_linha->>'nome'),''),'Nome não informado');
    begin v_data:=(v_linha->>'data')::date; exception when others then v_data:=null; end;
    if length(v_cpf)<>11 then v_inconsistencia:='CPF ausente ou inválido'; elsif v_data is null then v_inconsistencia:='Data do registro inválida'; else select f.id into v_funcionario_id from public.funcionarios f where regexp_replace(f.cpf,'[^0-9]','','g')=v_cpf and f.ativo=true limit 1; if v_funcionario_id is null then v_inconsistencia:='CPF não encontrado no cadastro ativo'; end if; end if;
    v_e1:=case when trim(coalesce(v_linha->>'entrada_1','')) ~ '^[0-9]{2}:[0-9]{2}' then substring(trim(v_linha->>'entrada_1') from '^[0-9]{2}:[0-9]{2}')::time else null end;
    v_s1:=case when trim(coalesce(v_linha->>'saida_1','')) ~ '^[0-9]{2}:[0-9]{2}' then substring(trim(v_linha->>'saida_1') from '^[0-9]{2}:[0-9]{2}')::time else null end;
    v_e2:=case when trim(coalesce(v_linha->>'entrada_2','')) ~ '^[0-9]{2}:[0-9]{2}' then substring(trim(v_linha->>'entrada_2') from '^[0-9]{2}:[0-9]{2}')::time else null end;
    v_s2:=case when trim(coalesce(v_linha->>'saida_2','')) ~ '^[0-9]{2}:[0-9]{2}' then substring(trim(v_linha->>'saida_2') from '^[0-9]{2}:[0-9]{2}')::time else null end;
    insert into public.ponto_import_linhas(importacao_id,funcionario_id,cpf,nome_csv,data,previsto,entrada_1,saida_1,entrada_2,saida_2,total_normais,total_noturno,dia_falta,horas_atraso,abono,extra_50,extra_100,desconta_dsr,justificativas,encontrado,inconsistencia,raw_data) values(v_importacao,v_funcionario_id,v_cpf,v_nome,coalesce(v_data,current_date),v_linha->>'previsto',v_e1,v_s1,v_e2,v_s2,v_linha->>'total_normais',v_linha->>'total_noturno',v_linha->>'dia_falta',v_linha->>'horas_atraso',v_linha->>'abono',v_linha->>'extra_50',v_linha->>'extra_100',v_linha->>'desconta_dsr',v_linha->>'justificativas',v_funcionario_id is not null,v_inconsistencia,v_linha);
    if v_funcionario_id is null then v_nao_encontradas:=v_nao_encontradas+1; v_cpfs:=v_cpfs||jsonb_build_array(case when v_cpf='' then v_nome else v_cpf end); else v_encontradas:=v_encontradas+1; end if;
  end loop;
  update public.ponto_importacoes set total_linhas=v_total,linhas_encontradas=v_encontradas,linhas_nao_encontradas=v_nao_encontradas,cpfs_nao_encontrados=v_cpfs where id=v_importacao;
  insert into public.auditoria_acoes(usuario_id,acao,entidade,detalhes) values(v_usuario.usuario_id,'analisou_importacao_ponto','ponto_importacoes',jsonb_build_object('importacao_id',v_importacao,'tipo',p_tipo,'competencia',p_competencia,'total_linhas',v_total,'linhas_encontradas',v_encontradas,'linhas_nao_encontradas',v_nao_encontradas));
  return jsonb_build_object('sucesso',true,'importacao_id',v_importacao,'status','pendente','total_linhas',v_total,'linhas_encontradas',v_encontradas,'linhas_nao_encontradas',v_nao_encontradas,'cpfs_nao_encontrados',v_cpfs);
end; $$;
grant execute on function public.app_importar_ponto(text,text,text,text,jsonb) to anon,authenticated;
