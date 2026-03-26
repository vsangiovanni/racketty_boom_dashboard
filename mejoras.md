# Mejoras recomendadas para Greg Tracker (enfocado en construccion)

Este analisis prioriza funcionalidades practicas para que la app pase de "control financiero base" a una solucion mas completa para companias de construccion.

## 1) Presupuestos por proyecto y control de desviaciones (Prioridad: Muy alta)

### Que falta
- Presupuesto inicial por proyecto, por categoria y por fase.
- Comparativo en tiempo real: presupuesto vs gasto real vs comprometido.
- Alertas cuando una categoria supera umbrales (80%, 100%, 120%).

### Valor para construccion
- Evita sobrecostos tempranos.
- Permite tomar decisiones antes de que el margen se deteriore.

### Sugerencia practica
- Agregar entidad `project_budgets` con versionado.
- Mostrar semaforo por categoria (verde/amarillo/rojo) en `project-details.html`.

---

## 2) Costos comprometidos y ordenes de compra (Prioridad: Muy alta)

### Que falta
- Registro de costos "comprometidos" (POs, materiales encargados, subcontratos firmados) aunque aun no esten facturados.
- Flujo de orden de compra basico con estado (Draft, Approved, Ordered, Received, Closed).

### Valor para construccion
- El gasto real llega tarde; el comprometido da visibilidad anticipada de caja y margen.

### Sugerencia practica
- Modulo de `purchase_orders` ligado a proyecto/categoria/vendor.
- KPI nuevo: `Projected Final Cost = Actual + Committed`.

---

## 3) Gestion de cambios de alcance (Change Orders) (Prioridad: Muy alta)

### Que falta
- Registro formal de cambio de alcance con impacto en costo y tiempo.
- Aprobaciones, evidencia y fecha efectiva.
- Impacto automatico en presupuesto e ingreso esperado.

### Valor para construccion
- Protege rentabilidad y reduce disputas con cliente.

### Sugerencia practica
- Entidad `change_orders` con estados (Proposed, Approved, Rejected, Billed).
- En insights IA: advertir proyectos con muchos cambios no facturados.

---

## 4) Programacion y avance de obra (Prioridad: Alta)

### Que falta
- Hitos del proyecto y porcentaje de avance fisico.
- Relacion entre avance fisico y avance financiero.

### Valor para construccion
- Evita "falsa rentabilidad" cuando se factura antes o despues del avance real.

### Sugerencia practica
- Hitos por proyecto con fechas plan/reales.
- KPI: `Cost Performance` y `Schedule Performance` simplificados.

---

## 5) Gestion documental de campo (Prioridad: Alta)

### Que falta
- Repositorio por proyecto para planos, contratos, permisos, RFIs, submittals, actas.
- Versiones y control de vigencia.

### Valor para construccion
- Menos retrabajo por usar documentos obsoletos.
- Mejor trazabilidad ante auditoria o reclamos.

### Sugerencia practica
- Carpeta documental por proyecto con etiquetas y expiracion.
- Busqueda por tipo de documento y fecha.

---

## 6) Control de subcontratistas y certificaciones (Prioridad: Alta)

### Que falta
- Perfil de subcontratista con seguros, certificaciones, vencimientos y cumplimiento.
- Bloqueo o alertas por documentos vencidos.

### Valor para construccion
- Reduce riesgo legal y operativo.

### Sugerencia practica
- Entidad `subcontractors` + tabla de compliance.
- Alertas en dashboard para vencimientos cercanos.

---

## 7) Horas de personal y costo de mano de obra (Prioridad: Alta)

### Que falta
- Timesheets por cuadrilla/empleado, proyecto y actividad.
- Integracion de costo hora, horas extra y cargas.

### Valor para construccion
- La mano de obra suele ser el costo mas sensible; hoy no hay visibilidad fina.

### Sugerencia practica
- Modulo `timesheets` con aprobacion semanal.
- KPI: costo de mano de obra real vs plan.

---

## 8) Equipos y maquinaria (Prioridad: Media-Alta)

### Que falta
- Registro de uso de maquinaria por proyecto (horas, combustible, mantenimiento).
- Costo por equipo y disponibilidad.

### Valor para construccion
- Permite asignar costo real de equipo a cada obra.

### Sugerencia practica
- Entidad `equipment_usage` vinculada a proyecto y fecha.
- Alertas de mantenimiento preventivo.

---

## 9) Facturacion por avance y cobranza (Prioridad: Muy alta)

### Que falta
- Plan de facturacion por hitos o progreso (% completion billing).
- Estado de facturas: emitida, vencida, cobrada, parcial.
- Aging de cuentas por cobrar.

### Valor para construccion
- Mejora flujo de caja y control de cartera.

### Sugerencia practica
- Modulo de invoices ligado a hitos/change orders.
- Dashboard de cobranza y DSO.

---

## 10) Flujo de aprobaciones (gastos, compras, pagos) (Prioridad: Alta)

### Que falta
- Aprobaciones multinivel por monto/proyecto/categoria.
- Bitacora de quien aprobo y cuando.

### Valor para construccion
- Control interno y prevencion de fugas.

### Sugerencia practica
- Motor simple de reglas (ej: > 5,000 requiere 2 aprobadores).

---

## 11) Impuestos y cumplimiento fiscal (Prioridad: Media-Alta)

### Que falta
- Reglas fiscales mas robustas por tipo de transaccion/jurisdiccion.
- Reportes listos para contabilidad y auditoria.

### Valor para construccion
- Menos riesgo en declaraciones y cierres contables.

### Sugerencia practica
- Libro fiscal exportable y conciliacion mensual.

---

## 12) BI y comparativos historicos (Prioridad: Media)

### Que falta
- Benchmark entre proyectos: margen, costo/m2, costo por fase, productividad.
- Prediccion de sobrecosto basada en historicos.

### Valor para construccion
- Mejora estimaciones futuras y competitividad en nuevas propuestas.

### Sugerencia practica
- Data mart ligero para analitica y panel de comparacion.

---

## 13) Seguridad empresarial y multiusuario (Prioridad: Muy alta)

### Que falta
- Roles y permisos granulares (Owner, PM, Site Engineer, Accountant, Viewer).
- Auditoria de cambios (quien edito, antes/despues).
- SSO/MFA para despliegue empresarial.

### Valor para construccion
- Escalabilidad organizacional y seguridad operativa.

### Sugerencia practica
- Reemplazar autenticacion basica por usuarios reales + RBAC.

---

## 14) Experiencia movil para obra (Prioridad: Alta)

### Que falta
- Flujos offline robustos para zonas sin conectividad.
- Carga rapida de evidencia en sitio (foto, voz, nota, geolocalizacion opcional).

### Valor para construccion
- Mayor adopcion real por personal de campo.

### Sugerencia practica
- Cola offline sincronizable para registros y adjuntos.

---

## 15) Integraciones clave (Prioridad: Media-Alta)

### Que falta
- Integracion con software contable (QuickBooks/Xero/ERP).
- Integracion con bancos para conciliacion.
- Integracion con herramientas de obra (Procore u otras, segun mercado objetivo).

### Valor para construccion
- Menos captura manual y menor riesgo de error.

### Sugerencia practica
- Empezar por export/import estandar + webhooks.

---

## Roadmap recomendado por fases

## Fase 1 (impacto inmediato)
- Presupuestos vs real vs comprometido.
- Facturacion/cobranza por proyecto.
- Roles y permisos basicos.
- Aprobaciones de gasto.

## Fase 2 (control operativo)
- Change orders.
- Timesheets y costo de mano de obra.
- Subcontratistas y compliance.
- Documentacion de obra.

## Fase 3 (escala y ventaja competitiva)
- Maquinaria y costos avanzados.
- BI comparativo y prediccion.
- Integraciones contables/bancarias/obra.

---

## Mejoras transversales para IA (ya que la app ya usa IA)

- Asistente de PM por proyecto: "que riesgos tengo este mes y por que".
- Deteccion de anomalias de costo por categoria/vendor.
- Recomendaciones de cash-flow a 30/60/90 dias.
- Resumen ejecutivo automatico semanal por proyecto (en ingles).

---

## Conclusion

La app ya cubre una base solida de registro financiero y analisis por proyecto. Para volverla realmente completa para construccion, el mayor salto viene de combinar:

- control de presupuesto/compromisos,
- ingresos y cobranza reflejados en el **ledger** (transacciones por proyecto),
- control de ejecucion (avance, mano de obra, subcontratos),
- y gobierno empresarial (roles, aprobaciones, auditoria).

## Ejecucion inmediata de la conclusion (solo estos 4 frentes)

### 1) Presupuesto y compromisos
- Entregable MVP:
  - presupuesto por proyecto (monto total y por categoria),
  - indicador `Budget vs Actual`,
  - estado de desviacion (OK / Warning / Overrun).
- Criterio de prueba:
  - crear presupuesto,
  - registrar gastos,
  - ver porcentaje consumido y alerta correcta.

### 2) Ingresos y cobranza (ledger, sin modulo de facturas)
- La app **no** mantiene un modulo de facturacion separado: los cobros e ingresos se registran como transacciones **Income** en el ledger, asignadas al proyecto.
- Criterio de prueba:
  - crear al menos dos transacciones **Income** con el mismo `project_id`,
  - verificar que el detalle del proyecto y el dashboard muestran esos montos.

### 3) Senales de ejecucion (automatizado desde ledger)
- El avance **fisico** en obra, horas de cuadrilla y subcontratos reales **no** se infieren solo del dinero; si hace falta, conviene un modulo de campo o integracion futura.
- Entregable MVP actual: **senales financieras** derivadas del ledger (conteo de gastos/ingresos, ventana de fechas, ritmo semanal promedio, ratio ingreso/gasto, % de presupuesto consumido si hay budget).
- Criterio de prueba:
  - registrar varias lineas Expense e Income en el proyecto,
  - abrir detalle del proyecto y verificar que las metricas automaticas cambian al agregar transacciones.

### 4) Gobierno empresarial
- Entregable MVP:
  - roles basicos (`Admin`, `Manager`, `Viewer`),
  - aprobacion simple de gastos sobre umbral,
  - log de auditoria para altas/ediciones/bajas.
- Criterio de prueba:
  - usuario `Viewer` no puede editar,
  - gasto mayor al umbral queda `Pending approval`,
  - acciones registradas en auditoria.

## Orden de implementacion recomendado (secuencial)
1. Presupuesto/compromisos
2. Ledger de ingresos por proyecto (Manual Entry / import / AI scan)
3. Ejecucion (avance + horas + subcontratos)
4. Gobierno (roles + aprobaciones + auditoria)

## Definicion de "listo para probarlo todo"
Se considera listo cuando:
- los 4 MVP anteriores existen en UI,
- tienen persistencia en base de datos,
- y pasan los criterios de prueba listados en cada bloque.

Ese conjunto convierte la plataforma en una herramienta de gestion integral, no solo de registro contable.
