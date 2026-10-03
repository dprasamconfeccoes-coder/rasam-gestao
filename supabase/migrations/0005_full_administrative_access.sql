-- RF Gestão: identidade do administrador operacional e central administrativa.

update public.funcionarios
set nome = 'Renan Ricardo', cargo = 'Gerente / Departamento Pessoal / Administrador', updated_at = now()
where regexp_replace(cpf, '[^0-9]', '', 'g') = '07056527930';

update public.usuarios u
set perfil = 'admin', nome_exibicao = 'Renan Ricardo', updated_at = now()
from public.funcionarios f
where u.funcionario_id = f.id and regexp_replace(f.cpf, '[^0-9]', '', 'g') = '07056527930';

create or replace function public.app_admin_ponto(p_token text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare v_perfil text; v_result jsonb;
begin
 select perfil into v_perfil from public.app_usuario_por_token(p_token) limit 1;
 if v_perfil not in ('admin','administrador','gestor') then return jsonb_build_object('sucesso',false,'erro','Acesso negado'); end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.data desc,x.nome),'[]'::jsonb) into v_result
 from (select r.id,r.data,r.entrada,r.saida_almoco,r.volta_almoco,r.saida,r.horas_trabalhadas,r.status,f.id as funcionario_id,f.nome,f.cpf,f.cargo
       from public.registros_ponto r join public.funcionarios f on f.id=r.funcionario_id
       where f.ativo=true order by r.data desc,f.nome limit 3000) x;
 return jsonb_build_object('sucesso',true,'registros',v_result);
end; $$;

create or replace function public.app_admin_justificativas(p_token text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare v_perfil text; v_result jsonb;
begin
 select perfil into v_perfil from public.app_usuario_por_token(p_token) limit 1;
 if v_perfil not in ('admin','administrador','gestor') then return jsonb_build_object('sucesso',false,'erro','Acesso negado'); end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.data_registro desc),'[]'::jsonb) into v_result
 from (select j.id,j.funcionario_id,j.data_registro,j.tipo,j.motivo,j.arquivo_nome,j.status,j.resposta_rh,j.analisado_em,f.nome,f.cpf
       from public.justificativas_ponto j join public.funcionarios f on f.id=j.funcionario_id order by j.data_registro desc limit 500) x;
 return jsonb_build_object('sucesso',true,'justificativas',v_result);
end; $$;

create or replace function public.app_admin_decidir_justificativa(p_token text,p_id uuid,p_status text,p_resposta text default null)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare v_perfil text; v_usuario uuid;
begin
 select perfil,usuario_id into v_perfil,v_usuario from public.app_usuario_por_token(p_token) limit 1;
 if v_perfil not in ('admin','administrador','gestor') then return jsonb_build_object('sucesso',false,'erro','Acesso negado'); end if;
 if p_status not in ('aceita','recusada','pendente') then return jsonb_build_object('sucesso',false,'erro','Status inválido'); end if;
 update public.justificativas_ponto set status=p_status,resposta_rh=trim(p_resposta),analisado_por=v_usuario,analisado_em=case when p_status='pendente' then null else now() end,updated_at=now() where id=p_id;
 if not found then return jsonb_build_object('sucesso',false,'erro','Justificativa não encontrada'); end if;
 return jsonb_build_object('sucesso',true);
end; $$;

create or replace function public.app_admin_atestados(p_token text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare v_perfil text; v_result jsonb;
begin
 select perfil into v_perfil from public.app_usuario_por_token(p_token) limit 1;
 if v_perfil not in ('admin','administrador','gestor') then return jsonb_build_object('sucesso',false,'erro','Acesso negado'); end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb) into v_result
 from (select a.id,a.funcionario_id,a.tipo,a.data_atendimento,a.dias,a.observacao,a.arquivo_url,a.arquivo_nome,a.status,a.status_label,a.observacao_rh,a.created_at,f.nome,f.cpf from public.atestados a join public.funcionarios f on f.id=a.funcionario_id order by a.created_at desc limit 500) x;
 return jsonb_build_object('sucesso',true,'atestados',v_result);
end; $$;

create or replace function public.app_admin_decidir_atestado(p_token text,p_id uuid,p_status text,p_observacao text default null)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare v_perfil text; v_label text;
begin
 select perfil into v_perfil from public.app_usuario_por_token(p_token) limit 1;
 if v_perfil not in ('admin','administrador','gestor') then return jsonb_build_object('sucesso',false,'erro','Acesso negado'); end if;
 if p_status not in ('aceito','recusado','aguardando') then return jsonb_build_object('sucesso',false,'erro','Status inválido'); end if;
 v_label:=case p_status when 'aceito' then '✅ Aceito' when 'recusado' then '❌ Recusado' else '🟡 Aguardando' end;
 update public.atestados set status=p_status,status_label=v_label,observacao_rh=trim(p_observacao),conferido_em=case when p_status='aguardando' then null else now() end,updated_at=now() where id=p_id;
 if not found then return jsonb_build_object('sucesso',false,'erro','Atestado não encontrado'); end if;
 return jsonb_build_object('sucesso',true);
end; $$;

create or replace function public.app_admin_solicitacoes(p_token text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare v_perfil text; v_result jsonb;
begin
 select perfil into v_perfil from public.app_usuario_por_token(p_token) limit 1;
 if v_perfil not in ('admin','administrador','gestor') then return jsonb_build_object('sucesso',false,'erro','Acesso negado'); end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb) into v_result from (select s.id,s.funcionario_id,s.tipo,s.descricao,s.anexo_nome,s.status,s.resposta,s.analisado_em,s.created_at,f.nome,f.cpf from public.rh_solicitacoes s join public.funcionarios f on f.id=s.funcionario_id order by s.created_at desc limit 500) x;
 return jsonb_build_object('sucesso',true,'solicitacoes',v_result);
end; $$;

create or replace function public.app_admin_responder_solicitacao(p_token text,p_id uuid,p_status text,p_resposta text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare v_perfil text; v_usuario uuid;
begin
 select perfil,usuario_id into v_perfil,v_usuario from public.app_usuario_por_token(p_token) limit 1;
 if v_perfil not in ('admin','administrador','gestor') then return jsonb_build_object('sucesso',false,'erro','Acesso negado'); end if;
 if p_status not in ('pendente','em_analise','atendida','recusada','cancelada') then return jsonb_build_object('sucesso',false,'erro','Status inválido'); end if;
 update public.rh_solicitacoes set status=p_status,resposta=trim(p_resposta),analisado_por=v_usuario,analisado_em=now(),updated_at=now() where id=p_id;
 if not found then return jsonb_build_object('sucesso',false,'erro','Solicitação não encontrada'); end if;
 return jsonb_build_object('sucesso',true);
end; $$;

create or replace function public.app_admin_publicar_aviso(p_token text,p_titulo text,p_conteudo text,p_prioridade text default 'normal')
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare v_perfil text; v_usuario uuid; v_id uuid;
begin
 select perfil,usuario_id into v_perfil,v_usuario from public.app_usuario_por_token(p_token) limit 1;
 if v_perfil not in ('admin','administrador','gestor') then return jsonb_build_object('sucesso',false,'erro','Acesso negado'); end if;
 if length(trim(coalesce(p_titulo,'')))<3 or length(trim(coalesce(p_conteudo,'')))<5 then return jsonb_build_object('sucesso',false,'erro','Preencha título e conteúdo'); end if;
 if p_prioridade not in ('normal','importante','urgente') then return jsonb_build_object('sucesso',false,'erro','Prioridade inválida'); end if;
 insert into public.rh_avisos(titulo,conteudo,prioridade,publicado,publicado_em,created_by) values(trim(p_titulo),trim(p_conteudo),p_prioridade,true,now(),v_usuario) returning id into v_id;
 return jsonb_build_object('sucesso',true,'id',v_id);
end; $$;

create or replace function public.app_admin_holerites(p_token text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare v_perfil text; v_result jsonb;
begin
 select perfil into v_perfil from public.app_usuario_por_token(p_token) limit 1;
 if v_perfil not in ('admin','administrador','gestor') then return jsonb_build_object('sucesso',false,'erro','Acesso negado'); end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.ano desc,x.mes desc,x.nome),'[]'::jsonb) into v_result from (select h.id,h.funcionario_id,h.mes,h.ano,h.arquivo_nome,h.arquivo_url,h.disponivel,f.nome,f.cpf from public.holerites h join public.funcionarios f on f.id=h.funcionario_id order by h.ano desc,h.mes desc,f.nome limit 1000) x;
 return jsonb_build_object('sucesso',true,'holerites',v_result);
end; $$;

create or replace function public.app_admin_direitos(p_token text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare v_perfil text; v_result jsonb;
begin
 select perfil into v_perfil from public.app_usuario_por_token(p_token) limit 1;
 if v_perfil not in ('admin','administrador','gestor') then return jsonb_build_object('sucesso',false,'erro','Acesso negado'); end if;
 select jsonb_build_object('dividas',(select coalesce(jsonb_agg(to_jsonb(x) order by x.vencimento nulls last),'[]'::jsonb) from (select id,credor,descricao,valor_original,saldo_devedor,vencimento,status,observacoes from public.dividas_gestao order by vencimento nulls last limit 500)x),'ordens',(select coalesce(jsonb_agg(to_jsonb(x) order by x.prazo nulls last),'[]'::jsonb) from (select id,numero,descricao,status,prioridade,prazo,quantidade,valor_total from public.ordens_servico order by prazo nulls last limit 500)x),'producao',(select coalesce(jsonb_agg(to_jsonb(x) order by x.prazo nulls last),'[]'::jsonb) from (select id,nome,status,prazo,quantidade,responsavel from public.producao_lotes order by prazo nulls last limit 500)x)) into v_result;
 return jsonb_build_object('sucesso',true)||v_result;
end; $$;

grant execute on function public.app_admin_ponto(text) to anon,authenticated;
grant execute on function public.app_admin_justificativas(text) to anon,authenticated;
grant execute on function public.app_admin_decidir_justificativa(text,uuid,text,text) to anon,authenticated;
grant execute on function public.app_admin_atestados(text) to anon,authenticated;
grant execute on function public.app_admin_decidir_atestado(text,uuid,text,text) to anon,authenticated;
grant execute on function public.app_admin_solicitacoes(text) to anon,authenticated;
grant execute on function public.app_admin_responder_solicitacao(text,uuid,text,text) to anon,authenticated;
grant execute on function public.app_admin_publicar_aviso(text,text,text,text) to anon,authenticated;
grant execute on function public.app_admin_holerites(text) to anon,authenticated;
grant execute on function public.app_admin_direitos(text) to anon,authenticated;

-- Mutations used by the operational center.
create or replace function public.app_admin_registrar_holerite(p_token text,p_funcionario_id uuid,p_mes integer,p_ano integer,p_arquivo_nome text,p_arquivo_url text) returns jsonb language plpgsql security definer set search_path=public,extensions as $$ declare v_perfil text; v_id uuid; begin select perfil into v_perfil from public.app_usuario_por_token(p_token) limit 1; if v_perfil not in('admin','administrador','gestor') then return jsonb_build_object('sucesso',false,'erro','Acesso negado'); end if; insert into public.holerites(funcionario_id,mes,ano,arquivo_nome,arquivo_url,disponivel) values(p_funcionario_id,p_mes,p_ano,trim(p_arquivo_nome),trim(p_arquivo_url),true) on conflict do nothing returning id into v_id; return jsonb_build_object('sucesso',true,'id',v_id); end; $$;
create or replace function public.app_admin_atualizar_divida(p_token text,p_id uuid,p_status text,p_saldo numeric) returns jsonb language plpgsql security definer set search_path=public,extensions as $$ declare v_perfil text; begin select perfil into v_perfil from public.app_usuario_por_token(p_token) limit 1; if v_perfil not in('admin','administrador','gestor') then return jsonb_build_object('sucesso',false,'erro','Acesso negado'); end if; update public.dividas_gestao set status=p_status,saldo_devedor=p_saldo,updated_at=now() where id=p_id; return jsonb_build_object('sucesso',true); end; $$;
create or replace function public.app_admin_atualizar_ordem(p_token text,p_id uuid,p_status text) returns jsonb language plpgsql security definer set search_path=public,extensions as $$ declare v_perfil text; begin select perfil into v_perfil from public.app_usuario_por_token(p_token) limit 1; if v_perfil not in('admin','administrador','gestor') then return jsonb_build_object('sucesso',false,'erro','Acesso negado'); end if; update public.ordens_servico set status=p_status,updated_at=now() where id=p_id; return jsonb_build_object('sucesso',true); end; $$;
create or replace function public.app_admin_atualizar_lote(p_token text,p_id uuid,p_status text) returns jsonb language plpgsql security definer set search_path=public,extensions as $$ declare v_perfil text; begin select perfil into v_perfil from public.app_usuario_por_token(p_token) limit 1; if v_perfil not in('admin','administrador','gestor') then return jsonb_build_object('sucesso',false,'erro','Acesso negado'); end if; update public.producao_lotes set status=p_status,updated_at=now() where id=p_id; return jsonb_build_object('sucesso',true); end; $$;
grant execute on function public.app_admin_registrar_holerite(text,uuid,integer,integer,text,text) to anon,authenticated;
grant execute on function public.app_admin_atualizar_divida(text,uuid,text,numeric) to anon,authenticated;
grant execute on function public.app_admin_atualizar_ordem(text,uuid,text) to anon,authenticated;
grant execute on function public.app_admin_atualizar_lote(text,uuid,text) to anon,authenticated;
