// Explicit maintenance gate during a source-to-destination database cutover.
const WRITE_METHODS=new Set(['POST','PUT','PATCH','DELETE']);
export const maintenanceEnabled=(env=process.env)=>env.SOCIO_MAINTENANCE_MODE==='1';
export const writesBlocked=(method,env=process.env)=>maintenanceEnabled(env)&&WRITE_METHODS.has(String(method).toUpperCase());
export const workersBlocked=(env=process.env)=>maintenanceEnabled(env);
