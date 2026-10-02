create database app_test;
create extension if not exists pg_stat_statements;
create role app_readonly login password 'readonly';
grant connect on database app to app_readonly;
grant usage on schema public to app_readonly;
grant select on all tables in schema public to app_readonly;
alter default privileges for role app in schema public grant select on tables to app_readonly;
grant pg_read_all_stats to app_readonly;
