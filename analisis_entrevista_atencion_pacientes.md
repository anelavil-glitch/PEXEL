# Análisis de la entrevista: atención de chats (WhatsApp, Instagram y Facebook)

**Para:** Iván (dev senior)
**Objetivo:** saber qué necesita la colaboradora que atiende los chats para que la IA automatice la atención de **pacientes nuevos y potenciales**.

> **Nota sobre la transcripción:** el audio estaba mal transcrito y los hablantes salían mezclados. Los reasigné según el sentido de cada frase:
> - **Colaboradora:** describe su día a día (cómo atiende los chats, qué plantillas usa, cómo agenda y cómo lleva el registro).
> - **Entrevistador:** propone soluciones (dashboard, bot que parezca humano, filtros, detección de idioma) y pide material (capturas, video).
>
> Los nombres propios que salen dudosos están marcados con **(verificar)**.

---

## 1. Contexto actual

- Atiende **2 WhatsApp de clínicas distintas**: "Smiler/Mayler" y "Fenx" **(verificar los nombres)**. Les da prioridad a los que tienen más mensajes.
- Además atiende **Instagram y Facebook** (DM y comentarios) cuando le queda tiempo. Le dedica casi todo el día a WhatsApp.
- Una de las clínicas tiene **2 sucursales** y el paciente elige a cuál ir.
- Agenda las citas en un software de agenda dental; en el audio suena como "Bentalit/Ventalito", probablemente **Dentalink (verificar)**.
- Lleva un **registro manual en una hoja de cálculo** con una pestaña por mes (octubre, noviembre…) y fórmulas.
- Se siente saturada: trabaja con 2 pantallas, muchas pestañas abiertas y lo describe como "caos". Hay días en que termina con "la cabeza echando humo".

## 2. Cómo trabaja hoy (el proceso que hay que automatizar)

1. Abre los **no leídos** y les da una vista rápida.
2. **Descarta** los mensajes que no sirven:
   - Gente que solo hizo clic en el anuncio y se envió el texto automático, sin ninguna pregunta.
   - Saludos sueltos ("buenos días"), videos o audios irrelevantes.
   - **Números equivocados**: el número de la clínica antes era de otra persona y todavía le escriben buscándola.
3. **Prioriza** a los que preguntaron algo más allá del texto del anuncio.
4. Responde con **plantillas (respuestas rápidas)**. Antes daba por hecho que el cliente quería el tratamiento del anuncio (por ejemplo, ortodoncia). Ahora manda un **saludo general**, del tipo "¿en qué te podemos ayudar?", porque mucha gente entra por error y la mayoría nunca contesta.
5. Si el paciente muestra interés, le manda la **plantilla de la promoción del mes**. Al inicio de cada mes crean una plantilla por cada promoción y las van actualizando.
6. Si quiere cita:
   - Le ofrece las 2 sucursales.
   - Coordinan fecha y hora.
   - Le manda la **plantilla de confirmación** con los datos de la cita.
   - La **registra en el sistema de agenda**: busca el día, toca el horario y escribe el **motivo** y el **origen** del paciente en el comentario. Usa **colores** para el estado de la cita.
7. **Seguimiento:** ella solo atiende a los pacientes **nuevos**. Cuando el paciente va a su primera cita, pasa a la **secretaria de la clínica**. Si **no se presentó**, ella revisa la agenda y lo vuelve a contactar.
8. **Instagram/Facebook:**
   - En los **comentarios** de la publicidad responde con plantilla ("vimos tu comentario, te escribimos por DM") y **cambia el texto** para que no se repita.
   - Por **DM** manda la plantilla del tratamiento que le interesa al paciente.
   - Casi toda la publicidad lleva directo a WhatsApp, así que las redes tienen menos volumen.
   - Cuando se acumulan, Instagram le puede tomar **un día entero**. La jefa le manda capturas pidiéndole que deje lo que está haciendo y atienda las redes.

## 3. Requerimientos para el sistema (lo que hay que construir)

### Prioridad alta
| # | Requerimiento | Detalle |
|---|---|---|
| R1 | **Filtrar y clasificar leads** en WhatsApp e Instagram/Facebook | Categorías: **quiere agendar**, **solo consulta**, **llegó por error / clic en el anuncio**, **no volvió a responder**, **número equivocado**. Así ella solo atiende a quien de verdad quiere una cita. |
| R2 | **Respuesta automática con tono humano** | Que el paciente no note que habla con un bot. Debe atender **varias conversaciones a la vez**. Usar las plantillas reales (saludo, promociones del mes, confirmación). |
| R3 | **Respuesta automática a comentarios** de la publicidad | Que no queden comentarios sin responder. Respuestas **variadas** (no siempre el mismo texto) y **según lo que pregunta** cada uno o según el tratamiento. |
| R4 | **Agendar directamente en el sistema de agenda** (¿Dentalink?) | Cuando se confirma la cita, crearla con **motivo**, **origen** (anuncio, IG, FB, WhatsApp) y **sucursal**. Hoy lo hace a mano, una por una. |
| R5 | **Idioma automático** | **Español por defecto.** Si el paciente escribe en inglés o pide que le hablen en inglés, cambiar a inglés en esa conversación. **No** mandar mensajes bilingües: los que hablan español no contestan cuando les escriben en inglés. |
| R6 | **Interfaz minimalista y unificada** | **Una sola pantalla** con todos los canales (los 2 WhatsApp, IG y FB). Ya probaron otra herramienta hace unos meses: funcionaba, pero era complicada. |

### Prioridad media
| # | Requerimiento | Detalle |
|---|---|---|
| R7 | **Dashboard / reporte** | Diario (al final del día) o cuando ella lo pida: cuántos leads entraron, cuántos solo consultaron, cuántos no respondieron, cuántos fueron clic sin interés y cuántos **agendaron**. Por canal y por clínica. |
| R8 | **Llenar automáticamente su hoja de registro** | Mantener el formato que ya usa (una pestaña por mes con fórmulas) para que deje de copiar los números a mano. |
| R9 | **Seguimiento a los que no asistieron** | Comparar la agenda con la asistencia y avisarle (o escribir automáticamente) a los pacientes nuevos que no fueron a su cita. |
| R10 | **Vista global de la agenda** | Una clínica tiene un solo doctor (vista semanal); la otra tiene varios y hoy hay que revisarla día por día. Quiere una **vista semanal de todos los doctores**. |

### Riesgos y restricciones
- **Bloqueos de WhatsApp:** este año hubo un incidente (en vacaciones) en el que se **bloquearon muchos números** por mensajes o audios masivos. Hay que usar la **API oficial de WhatsApp Business**, no hacer envíos masivos sin consentimiento y respetar las plantillas aprobadas por Meta.
- Responder comentarios con **el mismo texto repetido** puede hacer que Meta lo marque como spam; por eso hay que variar las respuestas (R3).
- El bot **no debe** atender a pacientes ya activos: esos son de la secretaria. Su alcance es solo pacientes **nuevos y potenciales**.

## 4. Pendientes / material a recopilar
- [ ] **Capturas de cada anuncio** + una breve descripción de qué se ofrece y qué hay que responder (se pidió en un documento Word).
- [ ] **Todas las plantillas actuales:** saludo, promociones del mes, confirmación de cita, respuestas a comentarios.
- [ ] **Video** de la colaboradora mostrando su pantalla y su proceso (quedó en mandarlo).
- [ ] **Hoja de registro** actual (estructura, columnas y fórmulas).
- [ ] **Acceso o API del sistema de agenda** (confirmar si es Dentalink), con doctores y sucursales.
- [ ] **Nombres exactos** de las clínicas y las sucursales.
- [ ] **Acceso a los 2 WhatsApp** (¿ya son WhatsApp Business API?) y a las cuentas de Meta (IG/FB).

## 5. Partes del audio que no se entienden (preguntar)
- "Después de sacar la restauración": ¿en qué momento exacto se manda la promoción?
- Qué pasó exactamente con el bloqueo de números en vacaciones.
- Qué herramienta usaron antes y por qué la dejaron.
- Qué significa cada color de cita en la agenda.
