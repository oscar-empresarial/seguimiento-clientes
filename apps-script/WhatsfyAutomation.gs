/**
 * FULL COMPANY - WHATSFY AUTOMATION v1 (MODO SEGURO)
 * -------------------------------------------------
 * Archivo independiente para pegar como WhatsfyAutomation.gs en Apps Script.
 * No contiene tokens. No habilita campañas reales por defecto.
 */

var WF_BASE_URL = 'https://app.whatsfy.co/api';
var WF_TEST_PHONE = '+573186034581';
var WF_MAX_ENVIOS_POR_EJECUCION = 1;
var WF_CONTROL_SHEET_ID = '1erVlgUj_mMksD4NHa1cqPA3ol7c0tJauWgtOkRYARBI';

// Flujos comerciales aprobados de Full Company (Whatsfy, 2026-07-17).
// Esta tabla solo configura IDs. No habilita ni ejecuta campañas.
var WF_FLUJOS_FULL_COMPANY = {
  toca_llamar: 1784319781645,
  prospecto_visitado: 1784319872117,
  primera_compra: 1784319939721,
  cotizacion_d7: 1784319982230,
  cotizacion_d15: 1784320043232,
  cotizacion_d30: 1784320115474,
  cliente_riesgo: 1784320152916,
  cliente_perdido: 1784320192156,
  cliente_atrasado: 1784320279282
};

function wfProps_() {
  return PropertiesService.getScriptProperties();
}

function wfSs_() {
  var p = wfProps_();
  // El archivo de control es único y está fijado explícitamente.
  // Nunca crear otro archivo automáticamente: eso podría dividir la información.
  var ss;
  try {
    ss = SpreadsheetApp.openById(WF_CONTROL_SHEET_ID);
  } catch (e) {
    throw new Error('No se pudo abrir el archivo oficial de control Whatsfy (' + WF_CONTROL_SHEET_ID + '). Revisa permisos. No se creó ningún archivo alterno. Detalle: ' + e.message);
  }
  if (ss.getName() !== 'Full Company - Control Whatsfy') {
    throw new Error('Bloqueo de seguridad: el ID configurado no corresponde a Full Company - Control Whatsfy.');
  }
  p.setProperty('WHATSFY_CONTROL_SHEET_ID', ss.getId());
  p.setProperty('WHATSFY_CONTROL_SHEET_URL', ss.getUrl());
  return ss;
}

function wfFijarArchivoControlCorrecto() {
  var ss = wfSs_();
  var r = {ok:true,nombre:ss.getName(),id:ss.getId(),url:ss.getUrl(),archivoFijado:ss.getId() === WF_CONTROL_SHEET_ID};
  console.log(JSON.stringify(r,null,2));
  return r;
}

function wfVerArchivoControl() {
  var ss = wfSs_();
  var r = {ok:true, nombre:ss.getName(), id:ss.getId(), url:ss.getUrl()};
  console.log(JSON.stringify(r, null, 2));
  return r;
}

function wfReintentar_(fn, intentos) {
  intentos = intentos || 4;
  var ultimo;
  for (var i=0; i<intentos; i++) {
    try { return fn(); }
    catch(e) {
      ultimo = e;
      if (String(e.message||e).toLowerCase().indexOf('timed out') === -1 || i === intentos-1) throw e;
      Utilities.sleep(1200 * (i + 1));
    }
  }
  throw ultimo;
}

function wfToken_() {
  var token = wfProps_().getProperty('WHATSFY_TOKEN');
  if (!token) throw new Error('Falta WHATSFY_TOKEN en Propiedades de la secuencia de comandos. No lo pegues dentro del código.');
  return token;
}

function wfRequest_(method, path, payload, formData) {
  var options = {
    method: String(method || 'get').toLowerCase(),
    muteHttpExceptions: true,
    headers: {'X-ACCESS-TOKEN': wfToken_()}
  };
  if (payload !== undefined && payload !== null) {
    options.contentType = 'application/json';
    options.payload = JSON.stringify(payload);
  } else if (formData) {
    options.payload = formData;
  }
  var res = UrlFetchApp.fetch(WF_BASE_URL + path, options);
  var code = res.getResponseCode();
  var raw = res.getContentText();
  var body;
  try { body = raw ? JSON.parse(raw) : {}; } catch (e) { body = {raw: raw}; }
  if (code < 200 || code >= 300) {
    throw new Error('Whatsfy HTTP ' + code + ' en ' + path + ': ' + String(raw).substring(0, 500));
  }
  return body;
}

function wfNormalizarTelefono_(valor) {
  var n = String(valor || '').replace(/\D/g, '');
  if (!n) return '';
  if (n.indexOf('57') === 0 && n.length === 12) return '+' + n;
  if (n.length === 10 && n.charAt(0) === '3') return '+57' + n;
  if (n.length > 10 && n.charAt(0) !== '+') return '+' + n;
  return n.charAt(0) === '+' ? n : '+' + n;
}

// Validador estricto para campañas de WhatsApp en Colombia.
// Si Siigo trae un prefijo de tres dígitos (por ejemplo 000 o 607)
// pegado antes de un celular, conserva únicamente el celular.
// Los teléfonos fijos quedan pendientes
// de revisión manual y nunca se usan para un envío automático.
function wfNormalizarMovilColombia_(valor) {
  var n = String(valor || '').replace(/\D/g, '');
  if (!n) return '';
  if (/^57[3][0-9]{9}$/.test(n)) return '+' + n;
  if (/^[3][0-9]{9}$/.test(n)) return '+57' + n;
  var pegado = n.match(/^[0-9]{3}([3][0-9]{9})$/);
  if (pegado) return '+57' + pegado[1];
  return '';
}

function wfConfigurarModoPrueba() {
  var p = wfProps_();
  p.setProperty('WHATSFY_MODO', 'PRUEBA');
  p.setProperty('WHATSFY_TELEFONO_PRUEBA', WF_TEST_PHONE);
  p.setProperty('WHATSFY_ENVIO_HABILITADO', 'NO');
  p.setProperty('WHATSFY_MAX_POR_EJECUCION', '1');
  console.log('Modo PRUEBA configurado. Envío real continúa DESHABILITADO.');
  return {modo:'PRUEBA', telefono:WF_TEST_PHONE, envioHabilitado:false, maximo:1};
}

function wfProbarConexion() {
  var r = wfRequest_('get', '/accounts/me');
  console.log(JSON.stringify({ok:true, cuenta:r.name || '', activa:r.active, contactos:r.total_users}, null, 2));
  return r;
}

function wfAsegurarHojas_() {
  var ss = wfSs_();
  wfCrearHojaSi_(ss, 'WhatsfyConsentimientos', ['Telefono','Estado','Fuente','Fecha','Evidencia','ClienteId','ActualizadoPor','Actualizado']);
  wfCrearHojaSi_(ss, 'WhatsfyExclusiones', ['Telefono','Motivo','Fuente','Fecha','ClienteId','Observacion']);
  wfCrearHojaSi_(ss, 'WhatsfyContactos', ['Telefono','WhatsfyContactId','ClienteId','NombreSiigo','UltimaSincronizacion','Estado','UltimoError']);
  wfCrearHojaSi_(ss, 'WhatsfyCola', ['Id','TelefonoOriginal','TelefonoDestino','ClienteId','Nombre','Segmento','FlowId','VariablesJSON','Programado','Estado','Intentos','UltimoError','Creado','Enviado','ContactId']);
  wfCrearHojaSi_(ss, 'WhatsfyEnvios', ['IdCola','Fecha','Telefono','ClienteId','Segmento','FlowId','ContactId','Resultado']);
  wfCrearHojaSi_(ss, 'WhatsfyCandidatos', ['CorridaId','CandidatoId','Segmento','FlowId','CotizacionId','Numero','FechaCotizacion','Dias','ClienteId','ClienteNombre','Telefono','Vendedor','Total','EstadoCotizacion','PublicUrl','Consentimiento','Motivo','EstadoRevision','Creado','RevisadoPor','RevisadoEn','UltimoError']);
  wfCrearHojaSi_(ss, 'WhatsfyAlertas', ['AlertaId','Creado','Tipo','Prioridad','ClienteId','ClienteNombre','TelefonoOriginal','TelefonoNormalizado','Segmento','Referencia','Motivo','Estado','Asesor','AsignadoEn','ResueltoEn','Observacion']);
  wfCrearHojaSi_(ss, 'WhatsfyBacklog', ['Id','Tema','Descripcion','Prioridad','Estado','SiguientePaso','Creado','Actualizado']);
  return ss;
}

function wfCrearHojaSi_(ss, nombre, headers) {
  return wfReintentar_(function(){
    var h = ss.getSheetByName(nombre);
    if (!h) h = ss.insertSheet(nombre);
    if (h.getLastRow() === 0) h.getRange(1,1,1,headers.length).setValues([headers]);
    return h;
  });
}

function wfInstalarEstructura() {
  wfAsegurarHojas_();
  var campos = wfAsegurarCamposPersonalizados_();
  var etiquetas = wfAsegurarEtiquetas_();
  var r = {ok:true, modo:wfProps_().getProperty('WHATSFY_MODO') || 'NO_CONFIGURADO', campos:campos, etiquetas:etiquetas};
  console.log(JSON.stringify(r, null, 2));
  return r;
}

function wfAsegurarEtiquetas_() {
  var nombres = ['NO_MENSAJES','AUTORIZA_MARKETING','CLIENTE_SIIGO'];
  var resultado = [];
  for (var i=0; i<nombres.length; i++) {
    var nombre = nombres[i];
    var existente = null;
    try { existente = wfRequest_('get','/accounts/tags/name/' + encodeURIComponent(nombre)); } catch(e) {}
    if (existente && existente.id) resultado.push({name:nombre,id:existente.id,creado:false});
    else {
      var nuevo = wfRequest_('post','/accounts/tags',null,{name:nombre});
      resultado.push({name:nombre,id:nuevo.id,creado:true});
    }
  }
  wfProps_().setProperty('WHATSFY_ETIQUETAS_JSON',JSON.stringify(resultado));
  return resultado;
}

function wfAsegurarCamposPersonalizados_() {
  var requeridos = [
    {name:'siigo_identificacion', type:0, description:'Cédula o NIT proveniente de Siigo'},
    {name:'siigo_direccion', type:0, description:'Dirección registrada en Siigo'},
    {name:'siigo_ciudad', type:0, description:'Ciudad registrada en Siigo'},
    {name:'seguimiento_cliente_url', type:0, description:'Enlace directo a la aplicación de seguimiento'},
    {name:'semaforo_cliente', type:0, description:'Estado comercial calculado por Full Company'},
    {name:'ultima_compra', type:0, description:'Última compra conocida'},
    {name:'autorizacion_marketing', type:4, description:'1=autorizado, 0=no autorizado'}
  ];
  var existentes = wfRequest_('get', '/accounts/custom_fields') || [];
  var mapa = {};
  for (var i=0; i<existentes.length; i++) mapa[String(existentes[i].name||'').toLowerCase()] = existentes[i];
  var resultado = [];
  for (var j=0; j<requeridos.length; j++) {
    var c = requeridos[j];
    if (mapa[c.name]) resultado.push({name:c.name,id:mapa[c.name].id,creado:false});
    else {
      var nuevo = wfRequest_('post', '/accounts/custom_fields', c);
      resultado.push({name:c.name,id:nuevo.id,creado:true});
    }
  }
  wfProps_().setProperty('WHATSFY_CAMPOS_JSON', JSON.stringify(resultado));
  return resultado;
}

function wfBuscarContactoPorTelefono_(telefono) {
  var phone = wfNormalizarTelefono_(telefono);
  if (!phone) return null;
  var r = wfRequest_('get', '/contacts/find_by_custom_field?field_id=phone&value=' + encodeURIComponent(phone));
  var lista = (r && r.data) || [];
  return lista.length ? lista[0] : null;
}

function wfSepararNombre_(nombre) {
  var limpio = String(nombre || '').trim();
  if (!limpio) return {first_name:'Cliente',last_name:''};
  var partes = limpio.split(/\s+/);
  return {first_name:partes.shift(), last_name:partes.join(' ')};
}

function wfCrearOEncontrarContacto_(cliente, telefonoDestino) {
  var phone = wfNormalizarTelefono_(telefonoDestino || cliente.telefono);
  if (!phone) throw new Error('Cliente sin teléfono móvil válido');
  var existe = wfBuscarContactoPorTelefono_(phone);
  if (existe) {
    wfActualizarCamposContacto_(existe.id, cliente);
    return existe;
  }
  var nombre = wfSepararNombre_(cliente.nombre);
  var payload = {
    phone: phone,
    email: cliente.email || '',
    first_name: nombre.first_name,
    last_name: nombre.last_name,
    gender: 'unknown',
    actions: [
      {action:'set_field_value',field_name:'siigo_identificacion',value:String(cliente.id||'')},
      {action:'set_field_value',field_name:'siigo_direccion',value:String(cliente.direccion||'')},
      {action:'set_field_value',field_name:'siigo_ciudad',value:String(cliente.ciudad||'')},
      {action:'set_field_value',field_name:'seguimiento_cliente_url',value:String(cliente.url||'')},
      {action:'set_field_value',field_name:'semaforo_cliente',value:String(cliente.estado||'')},
      {action:'set_field_value',field_name:'ultima_compra',value:String(cliente.ultimaCompra||'')},
      {action:'set_field_value',field_name:'autorizacion_marketing',value:cliente.autorizado ? '1' : '0'}
    ]
  };
  var creado = wfRequest_('post', '/contacts', payload);
  return creado.data || creado.contact || creado;
}

function wfActualizarCamposContacto_(contactId, cliente) {
  var existentes = wfRequest_('get','/accounts/custom_fields') || [];
  var valores = {
    siigo_identificacion:String(cliente.id||''),
    siigo_direccion:String(cliente.direccion||''),
    siigo_ciudad:String(cliente.ciudad||''),
    seguimiento_cliente_url:String(cliente.url||''),
    semaforo_cliente:String(cliente.estado||''),
    ultima_compra:String(cliente.ultimaCompra||''),
    autorizacion_marketing:cliente.autorizado ? '1' : '0'
  };
  for (var i=0; i<existentes.length; i++) {
    var c = existentes[i];
    if (valores[c.name] === undefined) continue;
    wfRequest_('post','/contacts/' + contactId + '/custom_fields/' + c.id,null,{value:valores[c.name]});
  }
}

function wfRegistrarConsentimiento(telefono, estado, fuente, evidencia, clienteId, usuario) {
  var phone = wfNormalizarTelefono_(telefono);
  if (!phone) throw new Error('Teléfono inválido');
  estado = String(estado || '').toUpperCase();
  if (['AUTORIZADO','RECHAZADO','REVOCADO'].indexOf(estado) === -1) throw new Error('Estado permitido: AUTORIZADO, RECHAZADO o REVOCADO');
  var ss = wfSs_();
  var h = ss.getSheetByName('WhatsfyConsentimientos');
  if (!h) h = wfCrearHojaSi_(ss,'WhatsfyConsentimientos',['Telefono','Estado','Fuente','Fecha','Evidencia','ClienteId','ActualizadoPor','Actualizado']);
  wfReintentar_(function(){ h.appendRow([phone,estado,fuente||'',new Date(),evidencia||'',clienteId||'',usuario||'',new Date()]); });
  if (estado === 'RECHAZADO' || estado === 'REVOCADO') wfExcluirTelefono(phone, estado, fuente, clienteId, evidencia);
  return {ok:true,telefono:phone,estado:estado};
}

function wfExcluirTelefono(telefono, motivo, fuente, clienteId, observacion) {
  var phone = wfNormalizarTelefono_(telefono);
  if (!phone) throw new Error('Teléfono inválido');
  var ss = wfSs_();
  var h = ss.getSheetByName('WhatsfyExclusiones');
  if (!h) h = wfCrearHojaSi_(ss,'WhatsfyExclusiones',['Telefono','Motivo','Fuente','Fecha','ClienteId','Observacion']);
  wfReintentar_(function(){ h.appendRow([phone,motivo||'SOLICITUD_CLIENTE',fuente||'',new Date(),clienteId||'',observacion||'']); });
  return {ok:true,telefono:phone,bloqueado:true};
}

function wfEstaExcluido_(telefono) {
  var phone = wfNormalizarTelefono_(telefono);
  var ss = wfSs_();
  var h = ss.getSheetByName('WhatsfyExclusiones');
  if (!h || h.getLastRow()<2) return false;
  var data = h.getRange(2,1,h.getLastRow()-1,1).getValues();
  for (var i=0; i<data.length; i++) {
    if (wfNormalizarTelefono_(data[i][0]) === phone) return true;
  }
  return false;
}

function wfTieneConsentimiento_(telefono) {
  var phone = wfNormalizarTelefono_(telefono);
  if (!phone || wfEstaExcluido_(phone)) return false;
  var ss = wfSs_();
  var h = ss.getSheetByName('WhatsfyConsentimientos');
  if (!h || h.getLastRow()<2) return false;
  var data = h.getRange(2,1,h.getLastRow()-1,2).getValues();
  for (var i=data.length-1; i>=0; i--) {
    if (wfNormalizarTelefono_(data[i][0]) === phone) {
      return String(data[i][1]).toUpperCase()==='AUTORIZADO';
    }
  }
  return false;
}

function wfRegistrarConsentimientoPruebaOscar() {
  return wfRegistrarConsentimiento(WF_TEST_PHONE,'AUTORIZADO','PRUEBA_TECNICA','Autorización exclusiva para probar la integración','PRUEBA_OSCAR','Oscar');
}

function wfCrearContactoPruebaOscar() {
  if (!wfTieneConsentimiento_(WF_TEST_PHONE)) throw new Error('Primero ejecuta wfRegistrarConsentimientoPruebaOscar');
  var cliente = {id:'PRUEBA_OSCAR',nombre:'Oscar Prueba Full Company',telefono:WF_TEST_PHONE,email:'',direccion:'Bucaramanga',ciudad:'Bucaramanga',estado:'prueba',ultimaCompra:'',autorizado:true,url:'https://oscar-empresarial.github.io/seguimiento-clientes/'};
  var c = wfCrearOEncontrarContacto_(cliente, WF_TEST_PHONE);
  console.log(JSON.stringify(c,null,2));
  return c;
}

function wfCrearColaPrueba(flowId, segmento) {
  flowId = Number(flowId || 0);
  if (!flowId) throw new Error('Indica el ID numérico del flow aprobado en Whatsfy');
  var ss = wfSs_();
  var h = ss.getSheetByName('WhatsfyCola');
  if (!h) throw new Error('Falta WhatsfyCola. Ejecuta primero wfInstalarSoloHojas.');
  var id = 'wf_test_' + Date.now();
  h.appendRow([id,WF_TEST_PHONE,WF_TEST_PHONE,'PRUEBA_OSCAR','Oscar Prueba',segmento||'prueba',flowId,'{}',new Date(),'PENDIENTE_PRUEBA',0,'',new Date(),'','']);
  return {ok:true,id:id,telefono:WF_TEST_PHONE,flowId:flowId,estado:'PENDIENTE_PRUEBA'};
}

function wfCrearColaPruebaDesdePropiedad() {
  var flowId = Number(wfProps_().getProperty('WHATSFY_FLOW_PRUEBA') || 0);
  if (!flowId) throw new Error('Crea la propiedad WHATSFY_FLOW_PRUEBA con el ID numérico del flow aprobado');
  var segmento = wfProps_().getProperty('WHATSFY_SEGMENTO_PRUEBA') || 'primera_compra';
  var r = wfCrearColaPrueba(flowId, segmento);
  console.log(JSON.stringify(r,null,2));
  return r;
}

function wfEnviarUnaPrueba() {
  var p = wfProps_();
  if (p.getProperty('WHATSFY_MODO') !== 'PRUEBA') throw new Error('El sistema no está en modo PRUEBA');
  if (p.getProperty('WHATSFY_ENVIO_HABILITADO') !== 'SI') throw new Error('Envío deshabilitado. Ejecuta wfHabilitarUnSoloEnvioPrueba justo antes de probar.');
  var ss = wfSs_();
  var h = ss.getSheetByName('WhatsfyCola');
  var data = h.getDataRange().getValues();
  for (var i=1; i<data.length; i++) {
    if (String(data[i][9]) !== 'PENDIENTE_PRUEBA') continue;
    var destino = wfNormalizarTelefono_(data[i][2]);
    if (destino !== WF_TEST_PHONE) throw new Error('Bloqueo de seguridad: el destino no es el teléfono de prueba');
    if (!wfTieneConsentimiento_(destino)) throw new Error('El teléfono de prueba no tiene consentimiento registrado');
    var contacto = wfBuscarContactoPorTelefono_(destino);
    if (!contacto || !contacto.id) throw new Error('No existe el contacto de prueba en Whatsfy');
    try {
      var flowId = Number(data[i][6]);
      var res = wfRequest_('post','/contacts/' + contacto.id + '/send/' + flowId);
      h.getRange(i+1,10).setValue('ENVIADO_PRUEBA');
      h.getRange(i+1,11).setValue(Number(data[i][10]||0)+1);
      h.getRange(i+1,14).setValue(new Date());
      h.getRange(i+1,15).setValue(contacto.id);
      ss.getSheetByName('WhatsfyEnvios').appendRow([data[i][0],new Date(),destino,data[i][3],data[i][5],flowId,contacto.id,JSON.stringify(res).substring(0,1000)]);
      p.setProperty('WHATSFY_ENVIO_HABILITADO','NO');
      return {ok:true,enviado:true,telefono:destino,flowId:flowId,contactId:contacto.id};
    } catch(e) {
      h.getRange(i+1,10).setValue('ERROR_PRUEBA');
      h.getRange(i+1,11).setValue(Number(data[i][10]||0)+1);
      h.getRange(i+1,12).setValue(e.message);
      p.setProperty('WHATSFY_ENVIO_HABILITADO','NO');
      throw e;
    }
  }
  throw new Error('No hay filas PENDIENTE_PRUEBA en WhatsfyCola');
}

// Instalación dividida: primero solo Sheets, después campos/etiquetas en Whatsfy.
// Es más estable para una hoja grande y puede repetirse sin duplicar nada.
function wfInstalarSoloHojas() {
  var ss = wfAsegurarHojas_();
  SpreadsheetApp.flush();
  var r = {ok:true,hoja:ss.getName(),creadas:['WhatsfyConsentimientos','WhatsfyExclusiones','WhatsfyContactos','WhatsfyCola','WhatsfyEnvios']};
  console.log(JSON.stringify(r,null,2));
  return r;
}

/**
 * Registra los nueve Flow ID y deja bloqueadas todas las campañas reales.
 * Puede ejecutarse varias veces sin duplicar nada.
 */
function wfConfigurarFlujosFullCompany() {
  var p = wfProps_();
  p.setProperty('WHATSFY_FLOWS_JSON', JSON.stringify(WF_FLUJOS_FULL_COMPANY));
  p.setProperty('WHATSFY_CAMPANAS_HABILITADAS', 'NO');
  p.setProperty('WHATSFY_ENVIO_HABILITADO', 'NO');
  var r = {ok:true, modo:'DIAGNOSTICO', enviosHabilitados:false, flujos:WF_FLUJOS_FULL_COMPANY};
  console.log(JSON.stringify(r,null,2));
  return r;
}

function wfFechaLocal_(valor) {
  if (!valor) return null;
  if (valor instanceof Date) {
    if (isNaN(valor.getTime())) return null;
    return new Date(valor.getFullYear(), valor.getMonth(), valor.getDate());
  }
  var s = String(valor).trim();
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  var d = m ? new Date(Number(m[1]), Number(m[2])-1, Number(m[3])) : new Date(s);
  if (isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function wfEstadoCerradoCotizacion_(estado) {
  var s = String(estado || '').toLowerCase();
  var cerrados = ['invoice','invoic','factur','convert','annul','anul','cancel','reject','rechaz','void','deleted','elimin','expire','vencid'];
  for (var i=0; i<cerrados.length; i++) if (s.indexOf(cerrados[i]) !== -1) return true;
  return false;
}

function wfFacturaValidaDiagnostico_(tipoDoc, estado) {
  var e = String(estado || '').toLowerCase();
  if (e.indexOf('annul') !== -1 || e.indexOf('anul') !== -1 || e.indexOf('cancel') !== -1 || e.indexOf('void') !== -1 || e.indexOf('deleted') !== -1) return false;
  var t = String(tipoDoc || '').toLowerCase();
  if (t.indexOf('nota') !== -1 || t.indexOf('credit') !== -1 || t.indexOf('débito') !== -1 || t.indexOf('debito') !== -1) return false;
  return true;
}

function wfMapaConsentimientos_() {
  var ss = wfSs_();
  var autorizados = {}, excluidos = {};
  var he = ss.getSheetByName('WhatsfyExclusiones');
  if (he && he.getLastRow() > 1) {
    var de = he.getRange(2,1,he.getLastRow()-1,1).getValues();
    for (var e=0; e<de.length; e++) {
      var pe = wfNormalizarTelefono_(de[e][0]);
      if (pe) excluidos[pe] = true;
    }
  }
  var hc = ss.getSheetByName('WhatsfyConsentimientos');
  if (hc && hc.getLastRow() > 1) {
    var dc = hc.getRange(2,1,hc.getLastRow()-1,2).getValues();
    for (var c=0; c<dc.length; c++) {
      var pc = wfNormalizarTelefono_(dc[c][0]);
      if (pc) autorizados[pc] = String(dc[c][1] || '').toUpperCase() === 'AUTORIZADO';
    }
  }
  return {autorizados:autorizados, excluidos:excluidos};
}

function wfAsegurarHojaCandidatos_() {
  var ss = wfSs_();
  var headers = ['CorridaId','CandidatoId','Segmento','FlowId','CotizacionId','Numero','FechaCotizacion','Dias','ClienteId','ClienteNombre','Telefono','Vendedor','Total','EstadoCotizacion','PublicUrl','Consentimiento','Motivo','EstadoRevision','Creado','RevisadoPor','RevisadoEn','UltimoError'];
  var h = ss.getSheetByName('WhatsfyCandidatos');
  if (!h) h = wfCrearHojaSi_(ss, 'WhatsfyCandidatos', headers);
  h.getRange('K:K').setNumberFormat('@');
  return h;
}

function wfAsegurarHojaAlertas_() {
  var ss = wfSs_();
  var headers = ['AlertaId','Creado','Tipo','Prioridad','ClienteId','ClienteNombre','TelefonoOriginal','TelefonoNormalizado','Segmento','Referencia','Motivo','Estado','Asesor','AsignadoEn','ResueltoEn','Observacion'];
  var h = ss.getSheetByName('WhatsfyAlertas');
  if (!h) h = wfCrearHojaSi_(ss, 'WhatsfyAlertas', headers);
  h.getRange('G:H').setNumberFormat('@');
  return h;
}

function wfMapaAlertas_(h) {
  var mapa = {};
  if (h.getLastRow() < 2) return mapa;
  var ids = h.getRange(2,1,h.getLastRow()-1,1).getValues();
  for (var i=0; i<ids.length; i++) if (ids[i][0]) mapa[String(ids[i][0])] = true;
  return mapa;
}

function wfGuardarAlertas_(h, existentes, filas) {
  var nuevas = [];
  for (var i=0; i<filas.length; i++) {
    var id = String(filas[i][0] || '');
    if (!id || existentes[id]) continue;
    nuevas.push(filas[i]);
    existentes[id] = true;
  }
  if (nuevas.length) h.getRange(h.getLastRow()+1,1,nuevas.length,nuevas[0].length).setValues(nuevas);
  return nuevas.length;
}

function wfAsegurarBacklog_() {
  var ss = wfSs_();
  var headers = ['Id','Tema','Descripcion','Prioridad','Estado','SiguientePaso','Creado','Actualizado'];
  var h = ss.getSheetByName('WhatsfyBacklog');
  if (!h) h = wfCrearHojaSi_(ss, 'WhatsfyBacklog', headers);
  var existentes = {};
  if (h.getLastRow() > 1) {
    var ids = h.getRange(2,1,h.getLastRow()-1,1).getValues();
    for (var i=0; i<ids.length; i++) if (ids[i][0]) existentes[String(ids[i][0])] = true;
  }
  var ahora = new Date();
  var filas = [];
  if (!existentes.cerebro_comercial_v1) filas.push([
    'cerebro_comercial_v1','Cerebro comercial y cierre de ventas',
    'Analizar conversaciones y contexto del cliente para sugerir estrategias humanas de seguimiento y cierre.',
    'ALTA','PENDIENTE','Implementar después de dejar envíos, respuestas y cancelaciones funcionando.',ahora,ahora
  ]);
  if (!existentes.escalamiento_sin_respuesta_v1) filas.push([
    'escalamiento_sin_respuesta_v1','Escalamiento de chats sin respuesta',
    'Crear lista para asesores con clientes que no respondieron, con prioridad, motivo y próximo paso recomendado.',
    'ALTA','PENDIENTE','Definir tiempos por segmento cuando el seguimiento de respuestas esté conectado.',ahora,ahora
  ]);
  if (filas.length) h.getRange(h.getLastRow()+1,1,filas.length,filas[0].length).setValues(filas);
  return {hoja:h.getName(),pendientesRegistrados:filas.length};
}

/**
 * SOLO DIAGNOSTICO: genera candidatos de cotizaciones con 7 a 14 días.
 * No escribe en WhatsfyCola, no crea contactos y no envía mensajes.
 */
function wfDiagnosticoCotizacionesD7() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) throw new Error('Ya hay otro diagnóstico en ejecución. Espera un momento.');
  try {
    wfConfigurarFlujosFullCompany();
    var principal = getOrCreateSheet();
    var hCot = principal.getSheetByName('SiigoCotizaciones');
    var hCli = principal.getSheetByName('SiigoClientes');
    var hFac = principal.getSheetByName('SiigoFacturas');
    if (!hCot || hCot.getLastRow() < 2) throw new Error('No hay cotizaciones sincronizadas en SiigoCotizaciones.');
    if (!hCli || hCli.getLastRow() < 2) throw new Error('No hay clientes sincronizados en SiigoClientes.');

    var clientes = {};
    var dc = hCli.getRange(2,1,hCli.getLastRow()-1,Math.min(13,hCli.getLastColumn())).getValues();
    for (var c=0; c<dc.length; c++) {
      var identC = normalizarIdentificacion(dc[c][1] || '');
      if (!identC) continue;
      clientes[identC] = {
        nombre:String(dc[c][2] || '').trim(),
        activo:dc[c][4] === true || String(dc[c][4]).toUpperCase() === 'TRUE',
        telefono:String(dc[c][7] || '').trim()
      };
    }

    // Última factura válida por cliente. Una compra el mismo día o posterior
    // a la cotización cancela la secuencia comercial de esa cotización.
    var ultimaFactura = {};
    if (hFac && hFac.getLastRow() > 1) {
      var df = hFac.getRange(2,1,hFac.getLastRow()-1,Math.min(15,hFac.getLastColumn())).getValues();
      var facturasVistas = {};
      for (var f=0; f<df.length; f++) {
        var fid = String(df[f][0] || '');
        if (!fid || facturasVistas[fid]) continue;
        facturasVistas[fid] = true;
        if (!wfFacturaValidaDiagnostico_(df[f][3], df[f][12])) continue;
        var identF = normalizarIdentificacion(df[f][5] || '');
        var fechaF = wfFechaLocal_(df[f][2]);
        if (!identF || !fechaF) continue;
        if (!ultimaFactura[identF] || fechaF > ultimaFactura[identF]) ultimaFactura[identF] = fechaF;
      }
    }

    var controles = wfMapaConsentimientos_();
    var hCand = wfAsegurarHojaCandidatos_();
    var hAlert = wfAsegurarHojaAlertas_();
    var alertasExistentes = wfMapaAlertas_(hAlert);
    var existentes = {};
    if (hCand.getLastRow() > 1) {
      var ids = hCand.getRange(2,2,hCand.getLastRow()-1,1).getValues();
      for (var x=0; x<ids.length; x++) if (ids[x][0]) existentes[String(ids[x][0])] = true;
    }

    var hoy = new Date();
    hoy = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
    var corridaId = 'diag_cot_d7_' + Date.now();
    var data = hCot.getRange(2,1,hCot.getLastRow()-1,Math.min(14,hCot.getLastColumn())).getValues();
    var filas = [];
    var alertas = [];
    var r = {ok:true,modo:'SOLO_DIAGNOSTICO',corridaId:corridaId,totalCotizaciones:data.length,abiertas:0,sinEstadoCotizacion:0,fueraVentana:0,facturadasDespues:0,sinCliente:0,clienteInactivo:0,sinTelefono:0,excluidos:0,sinConsentimiento:0,yaListadas:0,candidatasNuevas:0,alertasNuevas:0,enviosRealizados:0};
    var cotVistas = {};

    for (var i=0; i<data.length; i++) {
      var qid = String(data[i][0] || '');
      if (!qid || cotVistas[qid]) continue;
      cotVistas[qid] = true;
      var estado = String(data[i][11] || '');
      if (wfEstadoCerradoCotizacion_(estado)) continue;
      r.abiertas++;
      if (!estado.trim()) r.sinEstadoCotizacion++;
      var fechaQ = wfFechaLocal_(data[i][2]);
      if (!fechaQ) { r.fueraVentana++; continue; }
      var dias = Math.floor((hoy - fechaQ) / 86400000);
      if (dias < 7 || dias > 14) { r.fueraVentana++; continue; }
      var ident = normalizarIdentificacion(data[i][4] || '');
      var cli = clientes[ident];
      if (!ident || !cli) { r.sinCliente++; continue; }
      if (!cli.activo) { r.clienteInactivo++; continue; }
      if (ultimaFactura[ident] && ultimaFactura[ident] >= fechaQ) { r.facturadasDespues++; continue; }
      var phone = wfNormalizarMovilColombia_(cli.telefono);
      if (!phone) {
        r.sinTelefono++;
        var telefonoOriginal = String(cli.telefono || '');
        var motivoTelefono = telefonoOriginal
          ? 'El teléfono registrado no es un celular colombiano válido para WhatsApp.'
          : 'El cliente no tiene teléfono registrado.';
        alertas.push([
          'telefono_cot_d7_' + qid,new Date(),telefonoOriginal ? 'TELEFONO_INVALIDO' : 'SIN_TELEFONO','ALTA',
          ident,cli.nombre,"'" + telefonoOriginal,'','cotizacion_d7',String(data[i][1] || qid),
          motivoTelefono,'PENDIENTE','','','',''
        ]);
        continue;
      }
      if (controles.excluidos[phone]) { r.excluidos++; continue; }

      var candidatoId = 'cot_d7_' + qid;
      if (existentes[candidatoId]) { r.yaListadas++; continue; }
      var consentimiento = controles.autorizados[phone] ? 'AUTORIZADO' : 'PENDIENTE';
      if (consentimiento !== 'AUTORIZADO') r.sinConsentimiento++;
      filas.push([
        corridaId,candidatoId,'cotizacion_d7',WF_FLUJOS_FULL_COMPANY.cotizacion_d7,
        qid,String(data[i][1] || ''),Utilities.formatDate(fechaQ,'GMT-5','yyyy-MM-dd'),dias,
        ident,cli.nombre,"'" + phone,String(data[i][6] || ''),Number(data[i][10] || 0),estado,
        String(data[i][12] || ''),consentimiento,'Cotización abierta entre 7 y 14 días; sin factura posterior','REVISAR',new Date(),'','',''
      ]);
      existentes[candidatoId] = true;
    }

    if (filas.length) hCand.getRange(hCand.getLastRow()+1,1,filas.length,filas[0].length).setValues(filas);
    r.alertasNuevas = wfGuardarAlertas_(hAlert, alertasExistentes, alertas);
    r.candidatasNuevas = filas.length;
    r.hojaControl = wfSs_().getUrl();
    r.siguiente = 'Revisar WhatsfyCandidatos. Ningún envío está habilitado.';
    console.log(JSON.stringify(r,null,2));
    return r;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Corrige los teléfonos ya escritos en WhatsfyCandidatos.
 * No crea contactos, no llena la cola y no envía mensajes.
 */
function wfRevalidarTelefonosCandidatos() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) throw new Error('Ya hay otro proceso en ejecución. Espera un momento.');
  try {
    var h = wfAsegurarHojaCandidatos_();
    var hAlert = wfAsegurarHojaAlertas_();
    var alertasExistentes = wfMapaAlertas_(hAlert);
    var alertas = [];
    var total = Math.max(0, h.getLastRow() - 1);
    var r = {ok:true,modo:'SOLO_DIAGNOSTICO',total:total,validos:0,corregidos:0,invalidos:0,alertasNuevas:0,enviosRealizados:0};
    if (!total) {
      console.log(JSON.stringify(r,null,2));
      return r;
    }

    var data = h.getRange(2,1,total,22).getValues();
    for (var i=0; i<data.length; i++) {
      var original = String(data[i][10] || '').replace(/^'/, '');
      var normalizado = wfNormalizarMovilColombia_(original);
      if (normalizado) {
        r.validos++;
        if (normalizado !== original) {
          h.getRange(i+2,11).setValue("'" + normalizado);
          r.corregidos++;
        }
        if (String(data[i][17] || '') === 'TELEFONO_INVALIDO') h.getRange(i+2,18).setValue('REVISAR');
        h.getRange(i+2,22).setValue('');
      } else {
        r.invalidos++;
        h.getRange(i+2,18).setValue('TELEFONO_INVALIDO');
        h.getRange(i+2,22).setValue('No es un móvil colombiano válido: ' + original);
        alertas.push([
          'telefono_' + String(data[i][1] || (i+2)),new Date(),original ? 'TELEFONO_INVALIDO' : 'SIN_TELEFONO','ALTA',
          String(data[i][8] || ''),String(data[i][9] || ''),"'" + original,'',String(data[i][2] || ''),
          String(data[i][5] || data[i][4] || ''),
          original ? 'El teléfono registrado no es un celular colombiano válido para WhatsApp.' : 'El cliente no tiene teléfono registrado.',
          'PENDIENTE','','','',''
        ]);
      }
    }
    r.alertasNuevas = wfGuardarAlertas_(hAlert, alertasExistentes, alertas);
    console.log(JSON.stringify(r,null,2));
    return r;
  } finally {
    lock.releaseLock();
  }
}

// Ejecutar una vez después de pegar esta versión.
// Crea la bandeja de alertas, conserva los pendientes futuros y vuelve a
// validar los candidatos actuales. Nunca envía mensajes.
function wfPrepararAlertasYBacklog() {
  var backlog = wfAsegurarBacklog_();
  var telefonos = wfRevalidarTelefonosCandidatos();
  var r = {ok:true,modo:'SOLO_DIAGNOSTICO',backlog:backlog,telefonos:telefonos,enviosRealizados:0};
  console.log(JSON.stringify(r,null,2));
  return r;
}

function wfInstalarSoloWhatsfy() {
  var campos = wfAsegurarCamposPersonalizados_();
  var etiquetas = wfAsegurarEtiquetas_();
  var r = {ok:true,campos:campos,etiquetas:etiquetas};
  console.log(JSON.stringify(r,null,2));
  return r;
}

function wfHabilitarUnSoloEnvioPrueba() {
  wfProps_().setProperty('WHATSFY_ENVIO_HABILITADO','SI');
  wfProps_().setProperty('WHATSFY_MAX_POR_EJECUCION','1');
  return {habilitado:true,maximo:1,destinoPermitido:WF_TEST_PHONE};
}

function wfDeshabilitarEnvios() {
  wfProps_().setProperty('WHATSFY_ENVIO_HABILITADO','NO');
  return {habilitado:false};
}

// Actualiza solo el periodo reciente, acumula sin borrar el historial y reconstruye caches.

/**
 * CAPA DE SEGURIDAD OPERATIVA v2
 * ------------------------------
 * Registra respuestas, SALIR, compras y escalamiento sin enviar mensajes.
 * Toda señal cancela primero cualquier fila pendiente del mismo teléfono.
 */
function wfAsegurarHojaEventos_() {
  var ss = wfSs_();
  var headers = ['EventoId','Creado','Tipo','Telefono','ClienteId','Segmento','Referencia','Fuente','Detalle','ColaCancelada','AlertaId','Estado','Asesor','ProcesadoEn'];
  var h = ss.getSheetByName('WhatsfyEventos');
  if (!h) h = wfCrearHojaSi_(ss, 'WhatsfyEventos', headers);
  h.getRange('D:D').setNumberFormat('@');
  return h;
}

function wfTextoNormalizado_(texto) {
  return String(texto || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/\s+/g, ' ').trim();
}

function wfClasificarRespuesta_(texto) {
  var t = wfTextoNormalizado_(texto);
  if (/^(SALIR|STOP|CANCELAR|BAJA)$/.test(t) || /\b(NO (QUIERO|DESEO) (MAS )?MENSAJES|NO ME ESCRIBAN|RETIRENME)\b/.test(t)) return 'SALIR';
  return 'RESPUESTA';
}

function wfCancelarColaPendiente_(telefono, nuevoEstado, motivo) {
  var phone = wfNormalizarTelefono_(telefono);
  if (!phone) throw new Error('Teléfono inválido para cancelar la cola');
  var ss = wfSs_();
  var h = ss.getSheetByName('WhatsfyCola');
  if (!h || h.getLastRow() < 2) return {telefono:phone,canceladas:0,estado:nuevoEstado};
  var data = h.getDataRange().getValues();
  var canceladas = 0;
  for (var i=1; i<data.length; i++) {
    var original = wfNormalizarTelefono_(data[i][1]);
    var destino = wfNormalizarTelefono_(data[i][2]);
    if (phone !== original && phone !== destino) continue;
    var estado = String(data[i][9] || '').toUpperCase();
    var cancelable = estado.indexOf('PENDIENTE') === 0 || ['APROBADO','PROGRAMADO','LISTO','REINTENTAR'].indexOf(estado) !== -1;
    if (!cancelable) continue;
    h.getRange(i+1,10).setValue(nuevoEstado);
    h.getRange(i+1,12).setValue(motivo || nuevoEstado);
    canceladas++;
  }
  return {telefono:phone,canceladas:canceladas,estado:nuevoEstado};
}

function wfCrearAlertaEvento_(eventoId, tipo, prioridad, telefono, clienteId, nombre, segmento, referencia, motivo, estado, asesor, observacion) {
  var h = wfAsegurarHojaAlertas_();
  var existentes = wfMapaAlertas_(h);
  var ahora = new Date();
  var alertaId = 'wf_alert_' + eventoId;
  var fila = [[
    alertaId,ahora,tipo,prioridad,clienteId||'',nombre||'',telefono,telefono,
    segmento||'',referencia||'',motivo||'',estado||'PENDIENTE',asesor||'',
    asesor ? ahora : '',estado === 'RESUELTA' ? ahora : '',observacion||''
  ]];
  var creada = wfGuardarAlertas_(h, existentes, fila);
  return creada ? alertaId : '';
}

function wfRegistrarEventoSeguro(telefono, tipo, opciones) {
  opciones = opciones || {};
  var phone = wfNormalizarTelefono_(telefono);
  if (!phone) throw new Error('Teléfono inválido');
  tipo = String(tipo || '').toUpperCase();
  if (['RESPUESTA','SALIR','COMPRA','SIN_RESPUESTA'].indexOf(tipo) === -1) throw new Error('Tipo de evento no permitido');

  var ahora = new Date();
  var eventoId = 'wf_evt_' + ahora.getTime() + '_' + Math.floor(Math.random()*1000);
  var nuevoEstado = tipo === 'SALIR' ? 'CANCELADO_SALIR' :
                    tipo === 'COMPRA' ? 'CANCELADO_COMPRA' :
                    tipo === 'SIN_RESPUESTA' ? 'ESCALADO_SIN_RESPUESTA' : 'CANCELADO_RESPUESTA';

  if (tipo === 'SALIR') {
    wfRegistrarConsentimiento(phone,'REVOCADO',opciones.fuente||'RESPUESTA_WHATSAPP',opciones.detalle||'SALIR',opciones.clienteId||'',opciones.asesor||'SISTEMA');
  }
  var cancelacion = wfCancelarColaPendiente_(phone,nuevoEstado,'Evento '+tipo+': '+String(opciones.detalle||''));

  var alertaTipo = tipo === 'SALIR' ? 'BAJA_MARKETING' :
                   tipo === 'COMPRA' ? 'COMPRA_DETECTADA' :
                   tipo === 'SIN_RESPUESTA' ? 'ESCALAMIENTO_SIN_RESPUESTA' : 'RESPUESTA_CLIENTE';
  var prioridad = (tipo === 'RESPUESTA' || tipo === 'SIN_RESPUESTA') ? 'ALTA' : 'MEDIA';
  var estadoAlerta = (tipo === 'SALIR' || tipo === 'COMPRA') ? 'RESUELTA' : 'PENDIENTE';
  var alertaId = wfCrearAlertaEvento_(
    eventoId,alertaTipo,prioridad,phone,opciones.clienteId,opciones.nombre,
    opciones.segmento,opciones.referencia,opciones.detalle||tipo,estadoAlerta,
    opciones.asesor,opciones.observacion
  );

  var h = wfAsegurarHojaEventos_();
  h.appendRow([
    eventoId,ahora,tipo,phone,opciones.clienteId||'',opciones.segmento||'',
    opciones.referencia||'',opciones.fuente||'',opciones.detalle||'',
    cancelacion.canceladas,alertaId,'PROCESADO',opciones.asesor||'',new Date()
  ]);
  return {ok:true,eventoId:eventoId,tipo:tipo,telefono:phone,canceladas:cancelacion.canceladas,alertaId:alertaId,enviosRealizados:0};
}

function wfRegistrarRespuestaSegura(telefono, texto, clienteId, nombre, segmento, referencia, asesor) {
  var tipo = wfClasificarRespuesta_(texto);
  return wfRegistrarEventoSeguro(telefono,tipo,{
    clienteId:clienteId,nombre:nombre,segmento:segmento,referencia:referencia,
    asesor:asesor,fuente:'RESPUESTA_WHATSAPP',detalle:texto
  });
}

function wfRegistrarCompraSegura(telefono, referenciaCompra, clienteId, nombre, asesor) {
  return wfRegistrarEventoSeguro(telefono,'COMPRA',{
    clienteId:clienteId,nombre:nombre,referencia:referenciaCompra,
    asesor:asesor,fuente:'SIIGO_COMPRA',detalle:'Compra confirmada: '+String(referenciaCompra||'')
  });
}

function wfEscalarSinRespuestaSeguro(telefono, clienteId, nombre, segmento, referencia, asesor, horas) {
  return wfRegistrarEventoSeguro(telefono,'SIN_RESPUESTA',{
    clienteId:clienteId,nombre:nombre,segmento:segmento,referencia:referencia,
    asesor:asesor,fuente:'REGLA_TIEMPO',detalle:'Sin respuesta durante '+String(horas||'')+' horas'
  });
}

function wfValidarElegibilidadEnvio_(telefono) {
  var phone = wfNormalizarTelefono_(telefono);
  if (!phone) return {permitido:false,motivo:'TELEFONO_INVALIDO'};
  if (wfEstaExcluido_(phone)) return {permitido:false,motivo:'EXCLUIDO',telefono:phone};
  if (!wfTieneConsentimiento_(phone)) return {permitido:false,motivo:'SIN_CONSENTIMIENTO',telefono:phone};
  return {permitido:true,motivo:'AUTORIZADO',telefono:phone};
}

function wfPrepararAutomatizacionSegura() {
  var p = wfProps_();
  p.setProperty('WHATSFY_CAMPANAS_HABILITADAS','NO');
  p.setProperty('WHATSFY_ENVIO_HABILITADO','NO');
  var eventos = wfAsegurarHojaEventos_().getName();
  var alertas = wfAsegurarHojaAlertas_().getName();
  var backlog = wfAsegurarBacklog_();
  return {ok:true,modo:'PREPARADO_SIN_ENVIOS',eventos:eventos,alertas:alertas,backlog:backlog,campanas:false,envios:false};
}

function actualizarFacturasActualesSeguro() {
  var ss = getOrCreateSheet();
  var hf = ss.getSheetByName('SiigoFacturas');
  var antes = hf ? Math.max(0,hf.getLastRow()-1) : 0;
  if (antes < 1000) throw new Error('Bloqueo: la hoja conectada tiene muy pocas facturas ('+antes+'). Revisa sheetId.');
  var sync = sincronizarFacturasSiigo(obtenerFechaHaceDias(45));
  var despues = hf ? Math.max(0,hf.getLastRow()-1) : 0;
  if (despues < antes) throw new Error('Bloqueo: el total de facturas disminuyó. No se procesará el cache.');
  var proc = procesarClientesSiigo();
  var r = {antes:antes,despues:despues,nuevas:despues-antes,sincronizacion:sync,procesamiento:proc};
  console.log(JSON.stringify(r,null,2));
  return r;
}


/**
 * Entrada segura para eventos enviados por Pabbly.
 * Cerrada por defecto: requiere WF_WEBHOOK_SECRET y solo acepta el número de prueba
 * mientras WF_WEBHOOK_SOLO_PRUEBA no sea exactamente NO.
 *
 * IMPORTANTE (2026-07-21): esta funcion ya NO se llama doPost. Este proyecto
 * comparte espacio de nombres con Codigo.gs, que tiene su PROPIO doPost real
 * para la app de clientes -- tener dos funciones doPost hacia que SIEMPRE
 * ganara esta (la del webhook), y por eso la app de clientes recibia
 * "NO_AUTORIZADO" en cada accion (login, cargar_clientes, todo). Ahora
 * Codigo.gs detecta si la llamada trae wf_secret y, si es asi, delega aqui
 * mismo llamando a wfProcesarWebhookPabblyEntrada_. Si no trae wf_secret,
 * sigue de largo con su propia logica de login/acciones normal.
 */
function wfProcesarWebhookPabblyEntrada_(e) {
  try {
    return wfRespuestaWebhook_(wfProcesarWebhookPabbly_(e));
  } catch (err) {
    console.error('wf webhook: ' + err);
    return wfRespuestaWebhook_({
      ok: false,
      http: 500,
      error: 'ERROR_INTERNO'
    });
  }
}

function wfProcesarWebhookPabbly_(e) {
  var props = wfProps_();
  var secretoEsperado = String(props.getProperty('WF_WEBHOOK_SECRET') || '');
  if (!secretoEsperado) {
    return {ok:false,http:503,error:'WEBHOOK_NO_CONFIGURADO'};
  }

  var body = {};
  var raw = e && e.postData && e.postData.contents ? String(e.postData.contents) : '';
  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch (parseError) {
      return {ok:false,http:400,error:'JSON_INVALIDO'};
    }
  }

  var params = e && e.parameter ? e.parameter : {};
  var secretoRecibido = String(params.wf_secret || body.wf_secret || '');
  if (!secretoRecibido || secretoRecibido !== secretoEsperado) {
    return {ok:false,http:403,error:'NO_AUTORIZADO'};
  }

  var data = body && typeof body.data === 'object' && body.data ? body.data : {};
  var telefono = wfNormalizarTelefono_(
    params.telefono || params.phone ||
    body.telefono || body.phone || body.contact_id ||
    data.telefono || data.phone || data.contact_id || data.id ||
    body.id || ''
  );
  if (!telefono) {
    return {ok:false,http:400,error:'TELEFONO_INVALIDO'};
  }

  var soloPrueba = String(props.getProperty('WF_WEBHOOK_SOLO_PRUEBA') || 'SI').toUpperCase() !== 'NO';
  if (soloPrueba && telefono !== wfNormalizarTelefono_(WF_TEST_PHONE)) {
    return {ok:false,http:403,error:'SOLO_NUMERO_PRUEBA'};
  }

  var tipoRaw =
    params.tipo || body.tipo || body.event_type || body.event ||
    body.event_name || data.tipo || data.event_type || data.event || '';
  var tipo = wfMapearTipoEventoPabbly_(tipoRaw);
  if (!tipo) {
    return {ok:false,http:422,error:'TIPO_EVENTO_NO_PERMITIDO'};
  }

  var resultado = wfRegistrarEventoSeguro(telefono, tipo, {
    fuente: 'PABBLY_WHATSFY',
    detalle: String(body.detalle || body.text || data.detalle || data.text || ''),
    referencia: String(body.referencia || data.referencia || ''),
    asesor: String(body.asesor || data.asesor || '')
  });

  return {
    ok: true,
    http: 200,
    tipo: tipo,
    telefono: telefono,
    resultado: resultado
  };
}

function wfMapearTipoEventoPabbly_(valor) {
  var s = String(valor || '').trim().toUpperCase();
  if (/^(SALIR|STOP|BAJA|UNSUBSCRIBE)$/.test(s)) return 'SALIR';
  if (/^(RESPUESTA|REPLY|MESSAGE|MENSAJE)$/.test(s)) return 'RESPUESTA';
  if (/^(COMPRA|PURCHASE|ORDER_PAID|PAGO)$/.test(s)) return 'COMPRA';
  if (/^(SIN_RESPUESTA|NO_REPLY|TIMEOUT)$/.test(s)) return 'SIN_RESPUESTA';
  return '';
}

function wfRespuestaWebhook_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Ejecuta el flujo técnico Pabbly únicamente sobre el número autorizado de prueba.
 * No contiene mensajes y no habilita campañas comerciales.
 */
function wfDispararPruebaPabblySeguro() {
  var telefono = wfNormalizarTelefono_(WF_TEST_PHONE);
  var telefonoPermitido = wfNormalizarTelefono_('+573186034581');
  if (telefono !== telefonoPermitido) {
    throw new Error('SEGURIDAD: el flujo técnico sólo puede ejecutarse sobre el teléfono de prueba.');
  }
  var flowId = 1784500650738;
  var respuesta = wfRequest_('post', '/contacts', {
    phone: telefono,
    actions: [{action: 'send_flow', flow_id: flowId}]
  });
  return {ok: true, telefono: telefono, flowId: flowId, respuesta: respuesta};
}
