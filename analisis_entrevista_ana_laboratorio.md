# Análisis de la entrevista con Ana: coordinación del laboratorio dental

**Para:** Iván (dev senior)
**Objetivo:** entender el flujo de pedidos, producción y cobro del laboratorio, sacar los problemas que planteó Ana y convertirlos en requerimientos.

> **Nota sobre la transcripción:** hablaron varias personas a la vez y el texto viene corrido, sin separar quién dice qué, y con muchos errores. Lo ordené por el sentido de cada frase:
> - **Ana (coordinadora del laboratorio):** explica su trabajo, el Excel, la facturación, los formularios incompletos, los productos y los precios.
> - **Entrevistadores / dueño del proyecto:** proponen la app, el dashboard, el chatbot de WhatsApp, la integración con Dentalink y el portal para proveedores. La frase "si yo soy el creador del código puedo omitir esa brecha humana" es de alguien del lado técnico o de la dirección.
>
> Correcciones de nombres que hice: "Dalí / Dallen / Tallín / Talín / Candy / dengalín" = **Dentalink**. "Creando Sonrisa" y "Orión" parecen ser las clínicas del grupo **(verificar)**. Lo que no quedó claro está marcado con **(verificar)**.

---

## 1. Qué hace Ana hoy

Ana es la **coordinadora** del laboratorio dental. Fabrican guías quirúrgicas, férulas, coronas, alineadores y piezas sobre implantes. Su trabajo es:

1. **Registrar cada caso** (paciente) que mandan las clínicas.
2. **Seguir en qué etapa va** cada caso.
3. Cuando el trabajo está listo, **facturarlo** y mandar la factura.
4. **Dar seguimiento a los cobros**: cuánto debe cada clínica y qué está pendiente.
5. A fin de mes, **mandar a cada clínica el estado de cuenta** con todos los pacientes atendidos en el mes.

**Todo lo lleva en Excel, a mano.** Si se equivoca en un número, solo lo descubre al cuadrar el final (lo que tiene que cobrar contra los ítems y productos cargados).

## 2. Problemas que mencionó

| # | Problema | Impacto |
|---|---|---|
| P1 | **Todo en Excel y manual.** Registra cada caso, su etapa, la factura y el cobro a mano. | Errores de cifras que se descubren tarde, trabajo duplicado y nada en tiempo real. |
| P2 | **Las clínicas mandan formularios incompletos:** sin doctor, sin edad del paciente, sin indicaciones y sin diente. | No sabe quién trata al paciente ni de dónde viene el caso. Sin la edad no puede aplicar el **descuento de tercera edad (verificar)**. Tiene que escribirle a la clínica y esperar. |
| P3 | **Las clínicas mandan una captura de pantalla** de la orden de laboratorio de Dentalink en lugar del PDF que el sistema ya permite descargar. | Llega información incompleta o ilegible. Ana tiene que **entrar a Dentalink** solo para completar los datos, y no debería ser así. |
| P4 | **La información pasa por demasiadas manos.** El doctor le dice a alguien de la clínica que le diga al laboratorio lo que hace falta. Ella lo describió como un proceso "arcaico". | Demoras, datos que se pierden y fricción: el laboratorio queda esperando. |
| P5 | **Las clínicas no saben el precio al pedir.** Piden algo genérico ("guía quirúrgica", "coronas"), pero el precio depende del detalle: no cuesta lo mismo 1 implante que 2. | El precio solo se sabe cuando Ana revisa el caso, así que la clínica confirma sin saber cuánto va a pagar. |
| P6 | **Los pedidos llegan por varios canales:** WhatsApp, correo, la app y capturas. | No hay un solo lugar con la información, y se pierden pedidos y consultas. |
| P7 | **Las compras a proveedores** (anillos, materiales) se hacen por WhatsApp o correo. | Sin registro ni control de lo que se pidió. |
| P8 | **Hay 2 tipos de clientes con flujos distintos:** las clínicas **del grupo** (usan Dentalink) y las clínicas **externas** (piden por la app que ya existe). | El sistema tiene que manejar los dos casos. Lo de las externas todavía no está resuelto. |

## 3. Requerimientos (qué hay que construir)

### Prioridad alta
| # | Requerimiento | Detalle | Resuelve |
|---|---|---|---|
| R1 | **Sistema central de casos que reemplace el Excel** | Cada pedido = un caso con su clínica, doctor, paciente, etapa, precio, factura y pago. En **tiempo real**: la clínica y el laboratorio ven la misma información. | P1, P6 |
| R2 | **Formulario de pedido digital con campos obligatorios** | Sin estos datos no se puede enviar: clínica, **doctor**, paciente, **edad**, tipo de trabajo, **diente(s)**, **fecha de entrega deseada**, indicaciones. Además, **campos específicos según el producto**. Ejemplo, guía quirúrgica: **dentosoportada o mucosoportada**, **grosor de la férula**. Para alineadores, sus datos propios. **El laboratorio ya tiene este formulario en papel o archivo:** solo hay que pasarlo al sistema. | P2, P3 |
| R3 | **Integración con Dentalink (API)** para las clínicas del grupo | El doctor genera la orden de laboratorio **desde la ficha del paciente en Dentalink** y entra sola al sistema del laboratorio con los datos del paciente. Se elimina el paso "el doctor le dice a alguien que le diga al laboratorio". Mínimo aceptable: que el PDF de la orden llegue solo al correo del laboratorio. | P3, P4 |
| R4 | **App para clínicas externas** (ya hay una base hecha) | La clínica **crea una cuenta**, "como en Uber", con nombre, datos y **un correo único**. Desde ahí envía sus pedidos con el formulario de R2 y queda registrado quién pidió qué. | P6, P8 |
| R5 | **Paso de revisión y cotización antes de confirmar** | Flujo: la clínica pide algo genérico → **el laboratorio revisa** y asigna los productos reales (por ejemplo, "guía para 2 implantes") → el sistema calcula el precio → **la clínica lo aprueba** antes de pasar a producción. Antes de esa revisión se puede mostrar un **rango aproximado de precio**. Si la clínica dice que está muy caro, queda en negociación **(verificar quién la maneja)**. Ojo: **no** es "elige tu hamburguesa"; la clínica no elige el producto final, lo define el laboratorio. | P5 |
| R6 | **Seguimiento de etapas visible y amigable** | Etapas propuestas: **Recibido → En revisión/cotización → En aprobación → Diseño/planificación → En producción → Empaquetado → En camino → Entregado**. La interfaz tiene que ser **muy sencilla, al estilo del seguimiento de Amazon**: que la entienda cualquiera, "hasta un niño de kínder". Pidieron una animación simpática (un muñequito caminando entre etapas). | P1, P4 |
| R7 | **Aprobación de la planificación dentro de la app** | El laboratorio sube la planificación o el diseño, la clínica (el doctor) la **firma o aprueba** en la app y el caso sigue solo a producción. | P4 |

### Prioridad media
| # | Requerimiento | Detalle | Resuelve |
|---|---|---|---|
| R8 | **Facturación interna y cobros** | Al terminar un caso, se genera la **factura de control interno** (no es factura fiscal). Lleva el **saldo por clínica** y los **pagos recibidos**, y genera **solo** el **estado de cuenta mensual** de cada clínica. Es **híbrido**: el sistema de facturación que ya usan (lo mencionó Lorena o Faro, **verificar**) sigue como respaldo. | P1 |
| R9 | **Dashboard con filtros** | Por fecha, clínica, doctor, tipo de trabajo, edad y etapa; con vistas semanal y mensual. Muestra volumen, montos facturados y cobrados, y pendientes. | P1 |
| R10 | **Chatbot de WhatsApp conectado al sistema** | Las clínicas y los proveedores escriben por WhatsApp. El agente responde con **datos reales del sistema** (etapa del pedido, fecha de entrega, saldo). Los pedidos nuevos los manda a la app. Idea de "río": entre por donde entre, todo termina en un solo lugar. | P6 |
| R11 | **Portal o acceso para proveedores** | Cuando el laboratorio compra (anillos, materiales), el pedido se manda desde el sistema y el proveedor lo ve y responde ahí, como "una ramita del árbol". Por ahora sigue por WhatsApp o correo, pero queda registrado. | P7 |

### Principio de desarrollo
- **Iterativo:** empezar con lo básico y que Ana y las clínicas vayan pidiendo cambios con el uso ("me gustaría que aquí apareciera tal información"). No hace falta tener todo definido desde el inicio.

## 4. Flujo propuesto (resumen)

```
Clínica del grupo (Dentalink) ──API──┐
Clínica externa (App + cuenta) ──────┼──► Pedido con formulario completo
WhatsApp (chatbot) ──► redirige ─────┘            │
                                                  ▼
                               Laboratorio revisa → asigna productos → precio
                                                  │
                                                  ▼
                               Clínica aprueba precio y planificación
                                                  │
                                                  ▼
                   Diseño → Producción → Empaquetado → En camino → Entregado
                                                  │
                                                  ▼
                      Factura interna → Cobro → Estado de cuenta mensual
                                                  │
                                                  ▼
                                           Dashboard
```

## 5. Material a pedir
- [ ] **El formulario actual** del laboratorio, con todos los campos por tipo de producto (Ana dijo que ya lo tienen).
- [ ] **El Excel actual** de casos, facturación y cobros, para migrar los datos y respetar sus columnas.
- [ ] **La lista de productos y precios**, con sus reglas (por implante, por pieza, descuento de tercera edad).
- [ ] **El acceso a la API de Dentalink** de las clínicas del grupo.
- [ ] **El estado de la app** de clínicas externas que ya se empezó.
- [ ] **Un ejemplo de estado de cuenta mensual** y de factura interna.
- [ ] **La lista de clínicas** (del grupo y externas) y **de proveedores**.

## 6. Dudas a confirmar con Ana
1. ¿El descuento por edad es de **tercera edad**? ¿De cuánto es y desde qué edad aplica?
2. **Clínicas externas:** ¿precio fijo, rango o cotización manual? Ellos mismos dijeron que esa parte "todavía la están pensando".
3. Cuando una clínica rechaza el precio, ¿quién negocia? (En el audio se oye "Center", **verificar**.)
4. ¿Qué es "alineadores Philips afuera"? ¿Es una marca o un cliente externo de alineadores? **(verificar)**
5. ¿Qué significa "80 más anillos 90"? ¿Son precios, cantidades o códigos? **(verificar)**
6. ¿Qué sistema de facturación usan hoy y quién lo maneja (¿Lorena? ¿Faro?)?
7. ¿Las etapas que propuse coinciden con el proceso real del laboratorio?
