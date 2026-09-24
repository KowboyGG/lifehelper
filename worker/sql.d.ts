// wrangler импортирует .sql как текст
declare module "*.sql" {
  const sql: string;
  export default sql;
}
