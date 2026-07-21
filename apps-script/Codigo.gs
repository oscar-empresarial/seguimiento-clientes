/**
 * FULL COMPANY - SERVIDOR v2 (con autenticacion y permisos)
 * ========================================================
 * 
 * Cambios respecto a v1:
 * - Sistema de login con usuarios y contraseñas hasheadas
 * - Permisos granulares por rol
 * - Panel de administracion
 * - Log de acciones
 * - Preparado para integrar Siigo (Entrega 2)
 */

// ============================================================
// CONFIGURACION
// ============================================================
var SHEET_NOMBRE = 'Full Company - Datos';
var SESION_DIAS = 30;
var HASH_ITERACIONES = 1000;

// Permisos disponibles (18 permisos)
var PERMISOS_DISPONIBLES = {
  // Vision
  'ver_dashboard_equipo':     'Ver dashboard del equipo (sino, solo el suyo)',
  'ver_todos_clientes':       'Ver todos los clientes (sino, solo los asignados)',
  'ver_agenda_equipo':        'Ver agenda del equipo',
  'ver_reportes_avanzados':   'Ver reportes avanzados',
  'ver_carrera_caballos':     'Ver carrera de caballos',
  'ver_sugerencias_equipo':   'Ver sugerencias del equipo',
  'ver_log':                  'Ver log de acciones',
  // Accion
  'asignarse_clientes':       'Asignarse clientes nuevos',
  'reasignar_clientes':       'Reasignar clientes a otros',
  'cambiar_tipo_cliente':     'Cambiar tipo de cliente',
  'editar_notas_ajenas':      'Editar notas de clientes ajenos',
  'feedback_productos':       'Marcar feedback de productos olvidados',
  'registrar_actividad':      'Registrar llamadas y recordatorios',
  // Admin
  'admin_usuarios':           'Crear/editar/desactivar usuarios',
  'admin_permisos':           'Asignar permisos a otros',
  'admin_passwords':          'Resetear contraseñas',
  'admin_siigo':              'Configurar Siigo/sincronizacion',
  'admin_exportar':           'Exportar listas con contactos',
};

var ROLES = {
  'admin_total': {
    nombre: 'Admin Total',
    icon: '👑',
    permisos: Object.keys(PERMISOS_DISPONIBLES),
  },
  'vendedor_corporativo': {
    nombre: 'Vendedor Corporativo',
    icon: '🏢',
    permisos: [
      'ver_dashboard_equipo','ver_todos_clientes','ver_agenda_equipo',
      'ver_reportes_avanzados','ver_carrera_caballos','ver_sugerencias_equipo',
      'asignarse_clientes','reasignar_clientes','cambiar_tipo_cliente',
      'editar_notas_ajenas','feedback_productos','registrar_actividad',
      'admin_passwords','admin_exportar'
    ],
  },
  'vendedor_hogar': {
    nombre: 'Vendedor Hogar',
    icon: '🏠',
    permisos: [
      'ver_carrera_caballos',
      'asignarse_clientes','feedback_productos','registrar_actividad'
    ],
  },
  'solo_lectura': {
    nombre: 'Solo Lectura (Logistica)',
    icon: '📦',
    permisos: [
      'ver_dashboard_equipo','ver_todos_clientes','ver_agenda_equipo',
      'ver_carrera_caballos','ver_sugerencias_equipo',
      'registrar_actividad'
    ],
  },
};

// ============================================================
// API PUBLICA (entry points)
// ============================================================

function doGet(e) {
  try {
    var action = (e && e.parameter && e.parameter.action) || '';

    // Si abren el link normal, muestra la app HTML
    if (!action) {
      return HtmlService
        .createHtmlOutputFromFile('Index')
        .setTitle('Seguimiento de clientes');
    }

    // Si piden acciones por URL, responde JSON
    if (action === 'ping') {
      return jsonResponse({status: 'ok', version: 'v2', timestamp: Date.now()});
    }

    if (action === 'permisos_lista') {
      return jsonResponse({permisos: PERMISOS_DISPONIBLES, roles: ROLES});
    }

    return jsonResponse({error: 'Accion no reconocida: ' + action});
  } catch (err) {
    return jsonResponse({error: err.toString(), stack: err.stack});
  }
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var action = body.action;

    // Los eventos que llegan desde Pabbly (webhook de Whatsfy) usan "wf_secret"
    // en vez de "action" -- se delegan al manejador aparte en WhatsfyAutomation.gs.
    // (2026-07-21: antes ese archivo tenia su PROPIO doPost, que chocaba con este
    // y siempre ganaba, dejando toda la app de clientes en "NO_AUTORIZADO".)
    var paramsEntrada = e && e.parameter ? e.parameter : {};
    if (paramsEntrada.wf_secret || body.wf_secret) {
      return wfProcesarWebhookPabblyEntrada_(e);
    }

    if (action === 'login') {
      return jsonResponse(login(body.username, body.password));
    }
    if (action === 'cambiar_password_propia') {
      return jsonResponse(cambiarPasswordPropia(body.token, body.passwordActual, body.passwordNueva));
    }
    if (action === 'logout') {
      return jsonResponse(logout(body.token));
    }

    var user = validarToken(body.token);
    if (!user) return jsonResponse({error: 'Sesion invalida, vuelve a iniciar sesion', requireLogin: true});

    if (action === 'cargar') {
      return jsonResponse(cargarDatosParaUsuario(user));
    }
    if (action === 'guardar') {
      return jsonResponse(guardarDatos(user, body.datos));
    }
    if (action === 'captura_rapida') {
      return jsonResponse(guardarCapturaRapida(user, body.datos));
    }
    if (action === 'listar_capturas') {
      return jsonResponse(listarCapturas(user));
    }
    if (action === 'eliminar_captura') {
      return jsonResponse(eliminarCaptura(user, body.id));
    }
    if (action === 'editar_captura') {
      return jsonResponse(editarCaptura(user, body.id, body.cambios));
    }
    if (action === 'asignar_vendedor') {
      return jsonResponse(asignarVendedorCliente(user, body.clienteId, body.vendedor));
    }
    if (action === 'listar_vendedores') {
      return jsonResponse(listarVendedoresActivos());
    }
    if (action === 'marcar_descartado') {
      if (!tienePermiso(user, 'registrar_actividad')) return jsonResponse({error: 'Sin permisos'});
      return jsonResponse(marcarClienteDescartado(user, body.clienteId, body.motivo));
    }
    if (action === 'quitar_descartado') {
      if (!tienePermiso(user, 'registrar_actividad')) return jsonResponse({error: 'Sin permisos'});
      return jsonResponse(quitarClienteDescartado(user, body.clienteId));
    }
    if (action === 'actualizar_etapa_cliente') {
      return jsonResponse(actualizarEtapaCliente(user, body.clienteId, body.etapa));
    }
    if (action === 'eliminar_recordatorio') {
      if (!tienePermiso(user, 'registrar_actividad')) return jsonResponse({error: 'Sin permisos'});
      return jsonResponse(eliminarRecordatorio(user, body.id));
    }

    if (action === 'admin_listar_usuarios') {
      if (!tienePermiso(user, 'admin_usuarios')) return jsonResponse({error: 'Sin permisos'});
      return jsonResponse({usuarios: listarUsuarios()});
    }
    if (action === 'admin_crear_usuario') {
      if (!tienePermiso(user, 'admin_usuarios')) return jsonResponse({error: 'Sin permisos'});
      return jsonResponse(crearUsuario(body.usuario, user));
    }
    if (action === 'admin_editar_usuario') {
      if (!tienePermiso(user, 'admin_usuarios')) return jsonResponse({error: 'Sin permisos'});
      return jsonResponse(editarUsuario(body.username, body.cambios, user));
    }
    if (action === 'admin_desactivar') {
      if (!tienePermiso(user, 'admin_usuarios')) return jsonResponse({error: 'Sin permisos'});
      return jsonResponse(desactivarUsuario(body.username, user));
    }
    if (action === 'admin_resetear_password') {
      if (!tienePermiso(user, 'admin_passwords')) return jsonResponse({error: 'Sin permisos'});
      return jsonResponse(resetearPassword(body.username, body.passwordNueva, user));
    }
    if (action === 'admin_ver_log') {
      if (!tienePermiso(user, 'ver_log')) return jsonResponse({error: 'Sin permisos'});
      return jsonResponse({log: leerLog()});
    }

    // ----- SIIGO -----
    if (action === 'admin_siigo_estado') {
      if (!tienePermiso(user, 'admin_siigo')) return jsonResponse({error: 'Sin permisos'});
      return jsonResponse(obtenerEstadoSiigo());
    }
    if (action === 'admin_siigo_probar') {
      if (!tienePermiso(user, 'admin_siigo')) return jsonResponse({error: 'Sin permisos'});
      return jsonResponse(probarConexionSiigo());
    }
    if (action === 'admin_siigo_sincronizar') {
      if (!tienePermiso(user, 'admin_siigo')) return jsonResponse({error: 'Sin permisos'});
      var tipo = body.tipo || 'todo';
      return jsonResponse(ejecutarSincronizacion(tipo, user));
    }
    if (action === 'admin_siigo_instalar_trigger') {
      if (!tienePermiso(user, 'admin_siigo')) return jsonResponse({error: 'Sin permisos'});
      return jsonResponse(instalarTriggerSiigo());
    }
    if (action === 'admin_siigo_desinstalar_trigger') {
      if (!tienePermiso(user, 'admin_siigo')) return jsonResponse({error: 'Sin permisos'});
      return jsonResponse(desinstalarTriggerSiigo());
    }

    // Historial / datos comerciales de un cliente (Siigo)
    if (action === 'cliente_facturas') {
      return jsonResponse(obtenerFacturasCliente(body.identificacion));
    }
    if (action === 'cliente_cotizaciones') {
      return jsonResponse(obtenerCotizacionesClienteRapido(body.identificacion));
    }
    if (action === 'cotizaciones_pendientes') {
      return jsonResponse(listarCotizacionesPendientes());
    }
    if (action === 'cliente_cartera') {
      return jsonResponse(obtenerCarteraClienteRapido(body.identificacion));
    }

    if (action === 'admin_siigo_historial') {
      if (!tienePermiso(user, 'admin_siigo')) return jsonResponse({error: 'Sin permisos'});
      return jsonResponse(sincronizarHistorialCompleto());
    }
    if (action === 'admin_siigo_historial_reiniciar') {
      if (!tienePermiso(user, 'admin_siigo')) return jsonResponse({error: 'Sin permisos'});
      return jsonResponse(reiniciarHistorialSiigo());
    }
    if (action === 'admin_siigo_procesar') {
      if (!tienePermiso(user, 'admin_siigo')) return jsonResponse({error: 'Sin permisos'});
      return jsonResponse(procesarClientesSiigo());
    }
    if (action === 'cargar_clientes') {
      return jsonResponse(cargarClientesProcesados());
    }
    if (action === 'productos_cliente_obtener') {
      return jsonResponse(obtenerProductosCliente(body.identificacion));
    }
    if (action === 'cartera_obtener') {
      return jsonResponse(obtenerCarteraPendiente(body));
    }
    if (action === 'admin_carrera_reconstruir') {
      if (!tienePermiso(user, 'admin_siigo') && user.rol !== 'admin_total') return jsonResponse({error: 'Sin permisos'});
      return jsonResponse(reconstruirResumenCarrera());
    }

    // CARRERA DE CABALLOS
    if (action === 'carrera_obtener') {
      return jsonResponse(carreraObtener());
    }
    if (action === 'carrera_guardar_meta') {
      if (!tienePermiso(user, 'admin_siigo') && user.rol !== 'admin_total') {
        return jsonResponse({error: 'Solo admin puede configurar metas'});
      }
      return jsonResponse(carreraGuardarMeta(body.username, body.meta, body.mesAnio));
    }
    if (action === 'carrera_guardar_dias') {
      // Usuario puede guardar SUS propios dias. Admin puede editar de otros.
      var esPropio = String(body.username).toLowerCase() === String(user.username).toLowerCase();
      if (!esPropio && user.rol !== 'admin_total') {
        return jsonResponse({error: 'Solo puedes editar tus propios dias'});
      }
      return jsonResponse(carreraGuardarDias(body.username, body.dias, body.mesAnio));
    }

    return jsonResponse({error: 'Accion no reconocida: ' + action});
  } catch (err) {
    return jsonResponse({error: err.toString(), stack: err.stack});
  }
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// SHEET MANAGEMENT
// ============================================================

function getOrCreateSheet() {
  var props = PropertiesService.getScriptProperties();
  var sheetId = props.getProperty('sheetId');
  var ss;
  
  if (sheetId) {
    try { ss = SpreadsheetApp.openById(sheetId); }
    catch (e) { ss = null; }
  }
  
  if (!ss) {
    ss = SpreadsheetApp.create(SHEET_NOMBRE);
    props.setProperty('sheetId', ss.getId());
    inicializarHojas(ss);
    asegurarUsuariosIniciales(ss);
    Logger.log('Sheet creado: ' + ss.getUrl());
    // Si esto se dispara en producción, casi siempre es porque la propiedad
    // 'sheetId' quedó apuntando a una hoja que ya no se pudo abrir (borrada,
    // movida, mal copiada, etc.) y el sistema acaba de crear una hoja NUEVA
    // Y VACÍA con solo los usuarios de fábrica. Sin este aviso, eso pasa en
    // silencio y nadie se entera hasta que los usuarios reales no puedan
    // iniciar sesión (como pasó el 25 de junio de 2026).
    _alertarSheetNuevo(ss, sheetId);
  } else {
    asegurarHojas(ss);
    asegurarUsuariosIniciales(ss);
  }

  return ss;
}

function _alertarSheetNuevo(ssNueva, sheetIdAnterior) {
  try {
    var destinatario = 'xddelasemana@gmail.com';
    var asunto = '⚠️ Full Company: se creó una hoja de datos NUEVA (revisar)';
    var cuerpo = 'El sistema no pudo abrir la hoja de datos configurada '
      + '(sheetId anterior: ' + (sheetIdAnterior || '(vacío)') + ') y por eso '
      + 'creó una hoja nueva, vacía, con solo los usuarios de fábrica.\n\n'
      + 'Hoja nueva creada: ' + ssNueva.getUrl() + '\n\n'
      + 'Si esto fue inesperado, lo más probable es que la propiedad "sheetId" '
      + '(Configuración del proyecto > Propiedades de las secuencias de comandos) '
      + 'esté mal o apunte a una hoja borrada/movida. Corrígela antes de que los '
      + 'usuarios reporten que no pueden iniciar sesión.';
    MailApp.sendEmail(destinatario, asunto, cuerpo);
  } catch (e) {
    Logger.log('No se pudo enviar alerta de sheet nuevo: ' + e);
  }
}

function inicializarHojas(ss) {
  var hojaDefault = ss.getSheetByName('Sheet1') || ss.getSheetByName('Hoja 1');
  crearTodasLasHojas(ss);
  if (hojaDefault) ss.deleteSheet(hojaDefault);
}

function asegurarHojas(ss) {
  crearTodasLasHojas(ss);
  _asegurarColumnaAccionRecordatorios(ss);
}

// Las hojas de Oscar que ya existian antes de esta version solo tenian 8 columnas en
// Recordatorios (sin "Accion"). crearHojaSi() no toca hojas que ya existen, asi que sin
// esto el encabezado de la columna I se quedaria vacio para siempre. Es barato (una sola
// celda) y no hace nada si ya esta puesto, asi que es seguro dejarlo correr en cada
// solicitud.
function _asegurarColumnaAccionRecordatorios(ss) {
  var hoja = ss.getSheetByName('Recordatorios');
  if (!hoja) return;
  var celda = hoja.getRange(1, 9);
  if (!celda.getValue()) {
    celda.setValue('Accion').setFontWeight('bold').setBackground('#10A75B').setFontColor('white');
  }
}

function crearTodasLasHojas(ss) {
  crearHojaSi(ss, 'Usuarios',          ['Username','NombreCompleto','Rol','Permisos','PasswordHash','Salt','Activo','SesionToken','SesionExpira','UltimoLogin','Origen','SiigoUserId','CreadoEn'], '#1A7A3C');
  crearHojaSi(ss, 'Asignaciones',      ['ClienteID','Vendedor','Actualizado'], '#1A7A3C');
  crearHojaSi(ss, 'Notas',             ['ClienteID','Notas','Actualizado'], '#1B4F8C');
  crearHojaSi(ss, 'Llamadas',          ['ClienteID','Fecha','Hora','Vendedor','Resultado','Nota','Creado'], '#F08A2C');
  crearHojaSi(ss, 'Recordatorios',     ['ID','ClienteID','Fecha','Hora','Descripcion','Vendedor','Completado','Creado','Accion'], '#10A75B');
  crearHojaSi(ss, 'TiposOverride',     ['ClienteID','TipoNuevo','Actualizado'], '#5E2D9C');
  // Clientes marcados como "negocio cerrado / ya no existe": se sacan para siempre de
  // la lista de "A quien contactar hoy" sin borrar su historial de compras ni facturas.
  crearHojaSi(ss, 'ClientesDescartados', ['ClienteID','Motivo','Vendedor','Fecha'], '#888888');
  // Embudo de ventas para clientes de Siigo SIN compras todavia (o ya marcados
  // como negocio perdido): los clientes con historial de compras no usan esto,
  // se manejan por su total facturado. Ver actualizarEtapaCliente().
  crearHojaSi(ss, 'EtapasClientes',    ['ClienteID','Etapa','Vendedor','Actualizado'], '#E67E22');
  crearHojaSi(ss, 'HistorialCambios',  ['ID','ClienteID','Campo','Antes','Despues','Vendedor','Fecha'], '#5E2D9C');
  crearHojaSi(ss, 'FeedbackProductos', ['ClienteID','Producto','Tipo','Vendedor','Fecha'], '#E14B4B');
  crearHojaSi(ss, 'Sugerencias',       ['ID','Vendedor','Fecha','Sugerencia','Estado'], '#F08A2C');
  // SIIGO sync sheets
  crearHojaSi(ss, 'SiigoClientes',     ['IdSiigo','Identificacion','Nombre','TipoPersona','Activo','Ciudad','Direccion','Telefono','Email','VendedorId','UltimaCompra','TotalFacturado','Actualizado'], '#1E88E5');
  crearHojaSi(ss, 'SiigoFacturas',     ['IdSiigo','Numero','Fecha','TipoDoc','ClienteId','ClienteIdentificacion','VendedorId','Vendedor','Subtotal','Descuento','Impuestos','Total','Estado','Actualizado','PublicUrl'], '#1E88E5');
  crearHojaSi(ss, 'SiigoFacturaItems', ['FacturaId','Producto','Codigo','Cantidad','PrecioUnit','Descuento','Total'], '#42A5F5');
  crearHojaSi(ss, 'SiigoProductos',    ['IdSiigo','Codigo','Nombre','PrecioActual','Categoria','Activo','Actualizado'], '#1E88E5');
  crearHojaSi(ss, 'SiigoCotizaciones', ['IdSiigo','Numero','Fecha','ClienteId','ClienteIdentificacion','VendedorId','Vendedor','Subtotal','Descuento','Impuestos','Total','Estado','PublicUrl','Actualizado'], '#8E24AA');
  crearHojaSi(ss, 'SiigoCotizacionItems', ['CotizacionId','Producto','Codigo','Cantidad','PrecioUnitIVA','Descuento','Total'], '#AB47BC');
  crearHojaSi(ss, 'SiigoCartera',      ['ID','FacturaId','Numero','FechaFactura','FechaVencimiento','ClienteIdentificacion','ClienteNombre','VendedorId','Vendedor','ValorFactura','Saldo','DiasVencido','Estado','Actualizado'], '#C62828');
  crearHojaSi(ss, 'CotizacionesClienteCache', ['ClienteIdentificacion','Chunk','JSON','TotalCotizaciones','TotalItems','Actualizado'], '#7B1FA2');
  crearHojaSi(ss, 'CarteraClienteCache', ['ClienteIdentificacion','Chunk','JSON','Facturas','Saldo','Actualizado'], '#B71C1C');
  crearHojaSi(ss, 'FacturasClienteCache', ['ClienteIdentificacion','Chunk','JSON','TotalFacturas','Total','Actualizado'], '#1565C0');
  crearHojaSi(ss, 'VentasVendedorDia',  ['Fecha','VendedorId','Vendedor','Total','Facturas','Actualizado'], '#D97706');
  crearHojaSi(ss, 'SiigoEstadoSync',   ['Fecha','Tipo','Resultado','Detalles'], '#7B3FA8');
  crearHojaSi(ss, 'DatosCache',        ['ChunkJSON'], '#444444');
  // CARRERA DE CABALLOS
  crearHojaSi(ss, 'MetasCarrera',      ['Username','MetaMensual','MesAnio','Actualizado'], '#D97706');
  crearHojaSi(ss, 'DiasHabiles',       ['Username','MesAnio','DiasJSON','Actualizado'], '#D97706');
  crearHojaSi(ss, 'Log',               ['Fecha','Vendedor','Accion','Detalles'], '#888888');
  crearHojaSi(ss, 'CapturaRapida',     ['ID','Nombre','Empresa','Telefono','Documento','Direccion','Tipo','Seguimiento','Observaciones','Vendedor','VendedorNombre','Fecha','Estado'], '#E67E22');
}

function crearHojaSi(ss, nombre, cabeceras, color) {
  var hoja = ss.getSheetByName(nombre);
  if (hoja) return;  // Si la hoja ya existe, no la tocamos. Esto hace el servidor MUCHO mas rapido.

  // Solo cuando la hoja es nueva le ponemos titulos y formato.
  hoja = ss.insertSheet(nombre);
  hoja.getRange(1, 1, 1, cabeceras.length).setValues([cabeceras]);
  hoja.getRange(1, 1, 1, cabeceras.length)
      .setFontWeight('bold')
      .setBackground(color || '#1A7A3C')
      .setFontColor('white');
  hoja.setColumnWidths(1, cabeceras.length, 150);
  hoja.setFrozenRows(1);
}

// ============================================================
// USUARIOS INICIALES
// ============================================================

function asegurarUsuariosIniciales(ss) {
  var hojaUsuarios = ss.getSheetByName('Usuarios');
  var data = hojaUsuarios.getDataRange().getValues();
  
  // Contar usuarios reales (filas con username)
  var cuantos = 0;
  for (var i = 1; i < data.length; i++) {
    if (data[i][0]) cuantos++;
  }
  
  // IMPORTANTE: solo crear los iniciales si la tabla esta COMPLETAMENTE vacia.
  // Asi no se recrean (ni duplican) cuando el admin borra usuarios a proposito.
  if (cuantos > 0) return;
  
  var usuariosIniciales = [
    {username: 'oscar',    nombre: 'Oscar',    rol: 'admin_total',          password: 'oscar2026!'},
    {username: 'leandro',  nombre: 'Leandro',  rol: 'admin_total',          password: 'leandro2026!'},
    {username: 'martha',   nombre: 'Martha',   rol: 'admin_total',          password: 'martha2026!'},
    {username: 'cleiver',  nombre: 'Cleiver',  rol: 'vendedor_corporativo', password: 'cleiver2026'},
    {username: 'jhonatan', nombre: 'Jhonatan', rol: 'vendedor_hogar',       password: 'jhonatan2026'},
    {username: 'edwin',    nombre: 'Edwin',    rol: 'vendedor_hogar',       password: 'edwin2026'},
    {username: 'neider',   nombre: 'Neider',   rol: 'solo_lectura',         password: 'neider2026'},
  ];
  
  for (var i = 0; i < usuariosIniciales.length; i++) {
    var u = usuariosIniciales[i];
    crearUsuarioInterno(ss, u.username, u.nombre, u.rol, u.password, 'manual', '');
  }
}

function crearUsuarioInterno(ss, username, nombre, rol, password, origen, siigoUserId) {
  var hojaUsuarios = ss.getSheetByName('Usuarios');
  var salt = Utilities.getUuid();
  var hash = hashPassword(password, salt);
  var permisos = ROLES[rol] ? JSON.stringify(ROLES[rol].permisos) : '[]';
  
  hojaUsuarios.appendRow([
    username.toLowerCase(), nombre, rol, permisos, hash, salt,
    true, '', '', '', origen || 'manual', siigoUserId || '', new Date()
  ]);
}

// ============================================================
// HASH PASSWORDS
// ============================================================

function hashPassword(password, salt) {
  var raw = String(password) + ':' + String(salt) + ':fullcompany';
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, raw, Utilities.Charset.UTF_8
  );
  for (var i = 0; i < HASH_ITERACIONES; i++) {
    bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes);
  }
  return Utilities.base64Encode(bytes);
}

// ============================================================
// AUTENTICACION
// ============================================================

function login(username, password) {
  if (!username || !password) return {error: 'Falta usuario o contraseña'};
  username = String(username).toLowerCase().trim();
  
  var ss = getOrCreateSheet();
  var hoja = ss.getSheetByName('Usuarios');
  var data = hoja.getDataRange().getValues();
  
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).toLowerCase() === username) {
      if (!data[i][6]) return {error: 'Usuario desactivado. Contacta a un administrador.'};
      
      var hashCalculado = hashPassword(password, data[i][5]);
      if (hashCalculado !== data[i][4]) {
        registrarLog('login_fallido', username, '');
        return {error: 'Contraseña incorrecta'};
      }
      
      var token = Utilities.getUuid() + '-' + Date.now();
      var expira = new Date(Date.now() + SESION_DIAS * 24 * 60 * 60 * 1000);
      
      // Varios dispositivos pueden tener sesión activa a la vez (ej. computador y celular):
      // guardamos una LISTA de sesiones en vez de un solo token que se sobreescribe.
      var sesiones = _leerSesiones(data[i][7]);
      sesiones = sesiones.filter(function(s) { return new Date(s.e) > new Date(); }); // limpia vencidas
      sesiones.push({ t: token, e: expira.toISOString() });
      if (sesiones.length > 6) sesiones = sesiones.slice(sesiones.length - 6); // límite de seguridad
      
      hoja.getRange(i + 1, 8).setValue(JSON.stringify(sesiones));
      hoja.getRange(i + 1, 10).setValue(new Date());
      
      registrarLog('login', username, '');
      
      var rol = data[i][2];
      var permisos = [];
      try { permisos = JSON.parse(data[i][3] || '[]'); } catch (e) {}
      
      return {
        status: 'ok',
        token: token,
        usuario: {
          username: data[i][0],
          nombre: data[i][1],
          rol: rol,
          rolNombre: ROLES[rol] ? ROLES[rol].nombre : rol,
          rolIcon: ROLES[rol] ? ROLES[rol].icon : '👤',
          permisos: permisos,
        }
      };
    }
  }
  
  return {error: 'Usuario no encontrado'};
}

function validarToken(token) {
  if (!token) return null;
  var ss = getOrCreateSheet();
  var hoja = ss.getSheetByName('Usuarios');
  var data = hoja.getDataRange().getValues();
  
  for (var i = 1; i < data.length; i++) {
    var sesiones = _leerSesiones(data[i][7]);
    var sesion = sesiones.find(function(s) { return s.t === token; });
    if (sesion) {
      if (sesion.e && new Date(sesion.e) < new Date()) return null;
      if (!data[i][6]) return null;
      
      var rol = data[i][2];
      var permisos = [];
      try { permisos = JSON.parse(data[i][3] || '[]'); } catch (e) {}
      
      return {
        username: data[i][0],
        nombre: data[i][1],
        rol: rol,
        rolNombre: ROLES[rol] ? ROLES[rol].nombre : rol,
        permisos: permisos,
        row: i + 1,
      };
    }
  }
  return null;
}

// Lee la columna de sesiones (Token) y la interpreta como lista de {t: token, e: expiraISO}.
// Soporta el formato viejo (un solo token en texto plano) por si quedó alguna sesión activa
// justo en el momento de la actualización: esa sesión simplemente no hará match y pedirá
// volver a iniciar sesión una vez, sin romper nada.
function _leerSesiones(valorCelda) {
  if (!valorCelda) return [];
  try {
    var parsed = JSON.parse(valorCelda);
    if (Array.isArray(parsed)) return parsed;
    return [];
  } catch (e) {
    return [];
  }
}

function tienePermiso(user, permiso) {
  if (!user || !user.permisos) return false;
  return user.permisos.indexOf(permiso) !== -1;
}

function logout(token) {
  var user = validarToken(token);
  if (!user) return {status: 'ok'};
  var ss = getOrCreateSheet();
  var hoja = ss.getSheetByName('Usuarios');
  // Solo se cierra la sesión de ESTE dispositivo; si el usuario tiene la sesión abierta
  // en otro celular/computador, esa sigue activa.
  var data = hoja.getDataRange().getValues();
  var sesiones = _leerSesiones(data[user.row - 1][7]);
  sesiones = sesiones.filter(function(s) { return s.t !== token; });
  hoja.getRange(user.row, 8).setValue(JSON.stringify(sesiones));
  registrarLog('logout', user.username, '');
  return {status: 'ok'};
}

function cambiarPasswordPropia(token, passwordActual, passwordNueva) {
  var user = validarToken(token);
  if (!user) return {error: 'Sesion invalida'};
  if (!passwordNueva || passwordNueva.length < 6) return {error: 'La contraseña debe tener al menos 6 caracteres'};
  
  var ss = getOrCreateSheet();
  var hoja = ss.getSheetByName('Usuarios');
  var data = hoja.getRange(user.row, 1, 1, 13).getValues()[0];
  
  var hashActual = hashPassword(passwordActual, data[5]);
  if (hashActual !== data[4]) return {error: 'Contraseña actual incorrecta'};
  
  var nuevoSalt = Utilities.getUuid();
  var nuevoHash = hashPassword(passwordNueva, nuevoSalt);
  hoja.getRange(user.row, 5).setValue(nuevoHash);
  hoja.getRange(user.row, 6).setValue(nuevoSalt);
  
  registrarLog('cambio_password', user.username, 'propia');
  return {status: 'ok'};
}

// ============================================================
// ADMIN
// ============================================================

function listarUsuarios() {
  var ss = getOrCreateSheet();
  var hoja = ss.getSheetByName('Usuarios');
  var data = hoja.getDataRange().getValues();
  var lista = [];
  for (var i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    var rol = data[i][2];
    var permisos = [];
    try { permisos = JSON.parse(data[i][3] || '[]'); } catch (e) {}
    lista.push({
      username: data[i][0],
      nombre: data[i][1],
      rol: rol,
      rolNombre: ROLES[rol] ? ROLES[rol].nombre : rol,
      rolIcon: ROLES[rol] ? ROLES[rol].icon : '👤',
      permisos: permisos,
      activo: !!data[i][6],
      ultimoLogin: data[i][9] ? new Date(data[i][9]).toISOString() : null,
      origen: data[i][10] || 'manual',
      siigoUserId: data[i][11] || '',
    });
  }
  return lista;
}

function crearUsuario(datos, adminUser) {
  if (!datos.username || !datos.nombre || !datos.rol || !datos.password) {
    return {error: 'Faltan datos'};
  }
  
  var ss = getOrCreateSheet();
  var hoja = ss.getSheetByName('Usuarios');
  var data = hoja.getDataRange().getValues();
  
  var username = String(datos.username).toLowerCase().trim();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).toLowerCase() === username) {
      return {error: 'Ya existe un usuario con ese nombre'};
    }
  }
  
  crearUsuarioInterno(ss, username, datos.nombre, datos.rol, datos.password, datos.origen || 'manual', datos.siigoUserId || '');
  registrarLog('crear_usuario', adminUser.username, username);
  return {status: 'ok'};
}

function editarUsuario(username, cambios, adminUser) {
  username = String(username).toLowerCase().trim();
  var ss = getOrCreateSheet();
  var hoja = ss.getSheetByName('Usuarios');
  var data = hoja.getDataRange().getValues();
  
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).toLowerCase() === username) {
      if (cambios.nombre !== undefined) hoja.getRange(i + 1, 2).setValue(cambios.nombre);
      if (cambios.rol !== undefined) {
        hoja.getRange(i + 1, 3).setValue(cambios.rol);
        if (cambios.permisos === undefined && ROLES[cambios.rol]) {
          hoja.getRange(i + 1, 4).setValue(JSON.stringify(ROLES[cambios.rol].permisos));
        }
      }
      if (cambios.permisos !== undefined) hoja.getRange(i + 1, 4).setValue(JSON.stringify(cambios.permisos));
      var seDesactivo = false;
      if (cambios.activo !== undefined) {
        var activoAntes = !!data[i][6];
        hoja.getRange(i + 1, 7).setValue(!!cambios.activo);
        seDesactivo = activoAntes && !cambios.activo; // paso de activo a inactivo
      }

      registrarLog('editar_usuario', adminUser.username, username + ': ' + JSON.stringify(cambios));
      // Al desactivar, sus clientes/prospectos quedan SIN vendedor pero activos
      // (ver liberarAsignacionesDeUsuario) — nunca se borran ni se ocultan.
      if (seDesactivo) liberarAsignacionesDeUsuario(username, adminUser);
      return {status: 'ok'};
    }
  }
  return {error: 'Usuario no encontrado'};
}

function desactivarUsuario(username, adminUser) {
  return editarUsuario(username, {activo: false}, adminUser);
}

// Al desactivar un vendedor, sus clientes y prospectos NO se borran ni se ocultan:
// solo se les quita la asignación (quedan "sin vendedor") para que alguien más los
// pueda tomar. Toca dos lugares distintos porque la asignación se guarda de forma
// diferente según el tipo de registro:
//   - Clientes (vienen de Siigo): la asignación vive en la hoja "Asignaciones"
//     (ClienteID -> Vendedor). Quitarla es simplemente borrar esa fila; el cliente
//     en sí no se toca para nada.
//   - Prospectos (hoja "CapturaRapida"): el vendedor se guarda directo en la fila
//     del prospecto (columnas Vendedor/VendedorNombre). Aquí solo se vacían esas
//     dos columnas; el resto de la fila (estado, datos, etc.) queda intacto.
function liberarAsignacionesDeUsuario(username, adminUser) {
  username = String(username || '').toLowerCase().trim();
  if (!username) return { error: 'Falta username' };
  var ss = getOrCreateSheet();
  var clientesLiberados = 0;
  var prospectosLiberados = 0;

  // 1) Clientes Siigo: borrar sus filas en Asignaciones.
  var hojaAsig = ss.getSheetByName('Asignaciones');
  if (hojaAsig && hojaAsig.getLastRow() > 1) {
    var dataAsig = hojaAsig.getDataRange().getValues();
    for (var i = dataAsig.length - 1; i >= 1; i--) {
      if (String(dataAsig[i][1] || '').toLowerCase() === username) {
        hojaAsig.deleteRow(i + 1);
        clientesLiberados++;
      }
    }
  }

  // 2) Prospectos: vaciar Vendedor/VendedorNombre, sin tocar nada más de la fila.
  var hojaCap = ss.getSheetByName('CapturaRapida');
  if (hojaCap && hojaCap.getLastRow() > 1) {
    var dataCap = hojaCap.getDataRange().getValues();
    for (var i = 1; i < dataCap.length; i++) {
      if (String(dataCap[i][9] || '').toLowerCase() === username) {
        hojaCap.getRange(i + 1, 10, 1, 2).setValues([['', '']]);
        prospectosLiberados++;
      }
    }
  }

  registrarLog('liberar_asignaciones', (adminUser && adminUser.username) || 'sistema',
    username + ': ' + clientesLiberados + ' clientes, ' + prospectosLiberados + ' prospectos');
  return { status: 'ok', clientesLiberados: clientesLiberados, prospectosLiberados: prospectosLiberados };
}

function resetearPassword(username, passwordNueva, adminUser) {
  if (!passwordNueva || passwordNueva.length < 6) return {error: 'La contraseña debe tener al menos 6 caracteres'};
  
  username = String(username).toLowerCase().trim();
  var ss = getOrCreateSheet();
  var hoja = ss.getSheetByName('Usuarios');
  var data = hoja.getDataRange().getValues();
  
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).toLowerCase() === username) {
      var nuevoSalt = Utilities.getUuid();
      var nuevoHash = hashPassword(passwordNueva, nuevoSalt);
      hoja.getRange(i + 1, 5).setValue(nuevoHash);
      hoja.getRange(i + 1, 6).setValue(nuevoSalt);
      hoja.getRange(i + 1, 8).setValue('[]'); // cierra todas las sesiones activas de ese usuario
      
      registrarLog('resetear_password', adminUser.username, username);
      return {status: 'ok'};
    }
  }
  return {error: 'Usuario no encontrado'};
}

// ============================================================
// LOG
// ============================================================

function registrarLog(accion, vendedor, detalles) {
  try {
    var ss = getOrCreateSheet();
    var hoja = ss.getSheetByName('Log');
    hoja.appendRow([new Date(), vendedor, accion, detalles || '']);
    var rows = hoja.getLastRow();
    if (rows > 5001) hoja.deleteRows(2, rows - 5001);
  } catch (e) {
    Logger.log('Error log: ' + e);
  }
}

function leerLog() {
  var ss = getOrCreateSheet();
  var hoja = ss.getSheetByName('Log');
  var data = hoja.getDataRange().getValues();
  var lista = [];
  for (var i = Math.max(1, data.length - 200); i < data.length; i++) {
    lista.push({
      fecha: data[i][0] ? new Date(data[i][0]).toISOString() : '',
      vendedor: data[i][1] || '',
      accion: data[i][2] || '',
      detalles: data[i][3] || '',
    });
  }
  return lista.reverse();
}

// ============================================================
// CARGAR DATOS
// ============================================================

function cargarDatosParaUsuario(user) {
  var ss = getOrCreateSheet();
  
  var resultado = {
    asignaciones: cargarTodos(ss, 'Asignaciones', filaAsignacion),
    notas: cargarTodos(ss, 'Notas', filaNota),
    llamadas: cargarTodosArray(ss, 'Llamadas', filaLlamada),
    recordatorios: cargarTodosFlat(ss, 'Recordatorios', filaRecordatorio),
    tiposOverride: cargarTodos(ss, 'TiposOverride', filaTipoOverride),
    productoFeedback: cargarFeedbackProductos(ss),
    sugerencias: cargarTodosFlat(ss, 'Sugerencias', filaSugerencia),
    historialCambios: cargarTodosFlat(ss, 'HistorialCambios', filaHistorialCambio),
    descartados: cargarTodos(ss, 'ClientesDescartados', filaDescartado),
    etapasClientes: cargarTodos(ss, 'EtapasClientes', filaEtapaCliente),
  };
  
  if (!tienePermiso(user, 'ver_todos_clientes')) {
    var asigPropios = {};
    for (var k in resultado.asignaciones) {
      if (String(resultado.asignaciones[k]).toLowerCase() === user.username) {
        asigPropios[k] = resultado.asignaciones[k];
      }
    }
    resultado.clientesPermitidos = Object.keys(asigPropios);
    resultado.asignaciones = asigPropios;
  }
  
  if (!tienePermiso(user, 'ver_sugerencias_equipo')) {
    resultado.sugerencias = resultado.sugerencias.filter(function(s){
      return String(s.vendedor).toLowerCase() === user.username;
    });
  }
  
  return resultado;
}

function cargarTodos(ss, sheetName, mapper) {
  var hoja = ss.getSheetByName(sheetName);
  if (!hoja) return {};
  var data = hoja.getDataRange().getValues();
  var r = {};
  for (var i = 1; i < data.length; i++) {
    var key = mapper(data[i]);
    if (key) r[key.id] = key.value;
  }
  return r;
}

function cargarTodosArray(ss, sheetName, mapper) {
  var hoja = ss.getSheetByName(sheetName);
  if (!hoja) return {};
  var data = hoja.getDataRange().getValues();
  var r = {};
  for (var i = 1; i < data.length; i++) {
    var item = mapper(data[i]);
    if (!item) continue;
    if (!r[item.id]) r[item.id] = [];
    r[item.id].push(item.value);
  }
  return r;
}

function cargarTodosFlat(ss, sheetName, mapper) {
  var hoja = ss.getSheetByName(sheetName);
  if (!hoja) return [];
  var data = hoja.getDataRange().getValues();
  var r = [];
  for (var i = 1; i < data.length; i++) {
    var item = mapper(data[i]);
    if (item) r.push(item);
  }
  return r;
}

function filaDescartado(row) {
  if (!row[0]) return null;
  return {id: String(row[0]), value: String(row[1] || 'Cerrado')};
}
function filaAsignacion(row) {
  if (!row[0]) return null;
  return {id: String(row[0]), value: String(row[1] || '')};
}
function filaEtapaCliente(row) {
  if (!row[0]) return null;
  return {id: String(row[0]), value: String(row[1] || 'sin_contacto')};
}
function filaNota(row) {
  if (!row[0] || !row[1]) return null;
  return {id: String(row[0]), value: String(row[1])};
}
function filaTipoOverride(row) {
  if (!row[0] || !row[1]) return null;
  return {id: String(row[0]), value: String(row[1])};
}
function filaLlamada(row) {
  if (!row[0]) return null;
  return {id: String(row[0]), value: {
    fecha: String(row[1] || ''),
    hora: String(row[2] || ''),
    vendedor: String(row[3] || ''),
    resultado: String(row[4] || ''),
    nota: String(row[5] || ''),
    creado: String(row[6] || ''),
  }};
}
function filaRecordatorio(row) {
  if (!row[0]) return null;
  return {
    id: String(row[0]),
    clienteId: String(row[1] || ''),
    fecha: formatearFecha(row[2]),
    hora: formatearHoraRecordatorio(row[3]),
    descripcion: String(row[4] || ''),
    vendedor: String(row[5] || ''),
    completado: row[6] === true || row[6] === 'TRUE',
    creado: String(row[7] || ''),
    accion: String(row[8] || ''),
  };
}
// Google Sheets a veces guarda la columna "Hora" como un valor de Fecha/Hora real
// (si la celda quedo con formato de hora en vez de texto), y en ese caso getValues()
// devuelve un objeto Date de Apps Script en vez del texto "09:00". Al convertirlo a
// String() sin cuidado se obtenia algo sin sentido como "Sat Dec 30 1899 09:00:00
// GMT-0456 (hora estandar de Colombia)" en la pantalla de Mis Recordatorios. Esta
// funcion normaliza cualquier valor (texto limpio, Date, o texto con basura) a "HH:MM".
function formatearHoraRecordatorio(v) {
  if (v === null || v === undefined || v === '') return '09:00';
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime())) {
    var hh = ('0' + v.getHours()).slice(-2);
    var mm = ('0' + v.getMinutes()).slice(-2);
    return hh + ':' + mm;
  }
  var m = String(v).match(/\d{1,2}:\d{2}/);
  return m ? m[0] : '09:00';
}
function filaSugerencia(row) {
  if (!row[0]) return null;
  return {
    id: String(row[0]),
    vendedor: String(row[1] || ''),
    fecha: row[2] ? new Date(row[2]).toISOString() : '',
    texto: String(row[3] || ''),
    estado: String(row[4] || 'nueva'),
  };
}

function filaHistorialCambio(row) {
  if (!row[0]) return null;
  return {
    id: String(row[0]),
    clienteId: String(row[1] || ''),
    campo: String(row[2] || ''),
    antes: String(row[3] || ''),
    despues: String(row[4] || ''),
    vendedor: String(row[5] || ''),
    fecha: row[6] ? new Date(row[6]).toISOString() : '',
  };
}

function cargarFeedbackProductos(ss) {
  var hoja = ss.getSheetByName('FeedbackProductos');
  if (!hoja) return {};
  var data = hoja.getDataRange().getValues();
  var r = {};
  for (var i = 1; i < data.length; i++) {
    var cid = String(data[i][0] || '');
    var prod = String(data[i][1] || '');
    if (!cid || !prod) continue;
    if (!r[cid]) r[cid] = {};
    r[cid][prod] = {
      tipo: String(data[i][2] || ''),
      vendedor: String(data[i][3] || ''),
      fecha: String(data[i][4] || ''),
    };
  }
  return r;
}

function formatearFecha(v) {
  if (!v) return '';
  if (v instanceof Date) return v.toISOString().split('T')[0];
  return String(v).split('T')[0].split(' ')[0];
}

// ============================================================
// GUARDAR DATOS (con check de permisos)
// ============================================================

function guardarDatos(user, datos) {
  var ss = getOrCreateSheet();
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    
    if (datos.asignaciones !== undefined) {
      if (!tienePermiso(user, 'asignarse_clientes') && !tienePermiso(user, 'reasignar_clientes')) {
        return {error: 'Sin permiso para asignar clientes'};
      }
      guardarAsignaciones(ss, datos.asignaciones);
    }
    if (datos.notas !== undefined) guardarNotas(ss, datos.notas);
    if (datos.llamadas !== undefined && tienePermiso(user, 'registrar_actividad')) {
      guardarLlamadas(ss, datos.llamadas);
    }
    if (datos.recordatorios !== undefined && tienePermiso(user, 'registrar_actividad')) {
      guardarRecordatorios(ss, datos.recordatorios);
    }
    if (datos.tiposOverride !== undefined && tienePermiso(user, 'cambiar_tipo_cliente')) {
      guardarTiposOverride(ss, datos.tiposOverride);
    }
    if (datos.productoFeedback !== undefined && tienePermiso(user, 'feedback_productos')) {
      guardarFeedback(ss, datos.productoFeedback);
    }
    if (datos.sugerencias !== undefined) {
      guardarSugerencias(ss, datos.sugerencias);
    }
    if (datos.historialCambios !== undefined) {
      guardarHistorialCambios(ss, datos.historialCambios);
    }
    
    return {status: 'ok'};
  } finally {
    lock.releaseLock();
  }
}

function guardarHistorialCambios(ss, historial) {
  var hoja = ss.getSheetByName('HistorialCambios');
  if (!hoja) return;
  if (hoja.getLastRow() > 1) hoja.getRange(2, 1, hoja.getLastRow() - 1, hoja.getLastColumn()).clear();
  var filas = [];
  for (var i = 0; i < historial.length; i++) {
    var h = historial[i];
    filas.push([h.id || '', h.clienteId || '', h.campo || '', h.antes || '', h.despues || '', h.vendedor || '', h.fecha || '']);
  }
  if (filas.length > 0) hoja.getRange(2, 1, filas.length, 7).setValues(filas);
}

function guardarAsignaciones(ss, asignaciones) {
  var hoja = ss.getSheetByName('Asignaciones');
  if (hoja.getLastRow() > 1) hoja.getRange(2, 1, hoja.getLastRow() - 1, hoja.getLastColumn()).clear();
  var ahora = new Date();
  var filas = [];
  for (var id in asignaciones) {
    if (asignaciones[id]) filas.push([id, asignaciones[id], ahora]);
  }
  if (filas.length > 0) hoja.getRange(2, 1, filas.length, 3).setValues(filas);
}

// Asigna/reasigna UN cliente a un vendedor de forma atomica (solo toca esa fila,
// nunca borra ni reescribe el resto de la hoja). Esto reemplaza la forma anterior
// en que el navegador mandaba TODO su mapa local de asignaciones de una vez: si ese
// mapa estaba desactualizado (por ejemplo, otro vendedor no habia recargado la
// pagina), el guardado completo borraba reasignaciones hechas por otros mientras
// tanto. Con esta funcion cada cambio de vendedor queda grabado al instante y no
// pisa lo que hicieron los demas.
function asignarVendedorCliente(user, clienteId, vendedor) {
  if (!clienteId) return { error: 'Falta clienteId' };
  vendedor = String(vendedor || '').trim();

  // Asignarse un cliente a uno mismo requiere 'asignarse_clientes'. Asignarlo (o
  // quitarlo) a/de OTRO vendedor requiere el permiso mas fuerte 'reasignar_clientes'.
  var esParaUnoMismo = vendedor && vendedor.toLowerCase() === String(user.username || '').toLowerCase();
  var puedeAsignar = esParaUnoMismo
    ? (tienePermiso(user, 'asignarse_clientes') || tienePermiso(user, 'reasignar_clientes'))
    : tienePermiso(user, 'reasignar_clientes');
  if (!puedeAsignar) return { error: 'Sin permiso para asignar este cliente' };

  var ss = getOrCreateSheet();
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    var hoja = ss.getSheetByName('Asignaciones');
    if (!hoja) return { error: 'No existe la hoja Asignaciones' };
    var ahora = new Date();
    var filaEncontrada = -1;
    if (hoja.getLastRow() > 1) {
      var rango = hoja.getRange(2, 1, hoja.getLastRow() - 1, 1);
      var match = rango.createTextFinder(String(clienteId)).matchEntireCell(true).findNext();
      if (match) filaEncontrada = match.getRow();
    }
    if (!vendedor) {
      // Quitar asignacion (dejar el cliente sin vendedor asignado manualmente)
      if (filaEncontrada > 0) hoja.deleteRow(filaEncontrada);
    } else if (filaEncontrada > 0) {
      hoja.getRange(filaEncontrada, 2, 1, 2).setValues([[vendedor, ahora]]);
    } else {
      hoja.appendRow([clienteId, vendedor, ahora]);
    }
    registrarLog('asignar_vendedor', user.username, String(clienteId) + ' -> ' + (vendedor || '(sin asignar)'));
    return { status: 'ok', clienteId: String(clienteId), vendedor: vendedor };
  } finally {
    lock.releaseLock();
  }
}

// Embudo de ventas para un cliente de Siigo sin compras todavia (o ya perdido).
// Igual que asignarVendedorCliente: UPSERT puntual sobre EtapasClientes, nunca
// reescribe toda la hoja, asi que no pisa cambios de otros vendedores.
// Caso especial 'perdido': se mantiene sincronizado con ClientesDescartados
// (el mecanismo de "negocio cerrado" que ya existia) para que sea una sola
// fuente de verdad y el cliente tambien salga de la lista de "Hoy".
function actualizarEtapaCliente(user, clienteId, etapa) {
  if (!clienteId) return { error: 'Falta clienteId' };
  etapa = String(etapa || 'sin_contacto').trim();
  if (!tienePermiso(user, 'registrar_actividad')) return { error: 'Sin permisos' };

  var ss = getOrCreateSheet();
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    var hoja = ss.getSheetByName('EtapasClientes');
    if (!hoja) return { error: 'No existe la hoja EtapasClientes' };
    var ahora = new Date();
    var filaEncontrada = -1;
    if (hoja.getLastRow() > 1) {
      var rango = hoja.getRange(2, 1, hoja.getLastRow() - 1, 1);
      var match = rango.createTextFinder(String(clienteId)).matchEntireCell(true).findNext();
      if (match) filaEncontrada = match.getRow();
    }
    if (filaEncontrada > 0) {
      hoja.getRange(filaEncontrada, 2, 1, 3).setValues([[etapa, user.username, ahora]]);
    } else {
      hoja.appendRow([clienteId, etapa, user.username, ahora]);
    }
    registrarLog('etapa_cliente', user.username, String(clienteId) + ' -> ' + etapa);
  } finally {
    lock.releaseLock();
  }

  // Mantener ClientesDescartados sincronizado con la etapa 'perdido'.
  if (etapa === 'perdido') {
    marcarClienteDescartado(user, clienteId, 'Perdido (embudo)');
  } else {
    // Si venia marcado como perdido y se mueve a otra etapa, se reactiva.
    quitarClienteDescartado(user, clienteId);
  }

  return { status: 'ok', clienteId: String(clienteId), etapa: etapa };
}

// Marca un cliente como "negocio cerrado / ya no existe": no se borra nada de su
// historial ni de Siigo, solo se guarda en ClientesDescartados para que la pagina
// "A quien contactar hoy" deje de mostrarlo para siempre (en vez de seguir
// sugiriendo llamar a una empresa que ya cerro).
function marcarClienteDescartado(user, clienteId, motivo) {
  if (!clienteId) return { error: 'Falta clienteId' };
  motivo = String(motivo || 'Cerrado').trim() || 'Cerrado';
  var ss = getOrCreateSheet();
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    var hoja = ss.getSheetByName('ClientesDescartados');
    if (!hoja) return { error: 'No existe la hoja ClientesDescartados' };
    var ahora = new Date();
    var filaEncontrada = -1;
    if (hoja.getLastRow() > 1) {
      var rango = hoja.getRange(2, 1, hoja.getLastRow() - 1, 1);
      var match = rango.createTextFinder(String(clienteId)).matchEntireCell(true).findNext();
      if (match) filaEncontrada = match.getRow();
    }
    if (filaEncontrada > 0) {
      hoja.getRange(filaEncontrada, 2, 1, 3).setValues([[motivo, user.username, ahora]]);
    } else {
      hoja.appendRow([clienteId, motivo, user.username, ahora]);
    }
    registrarLog('marcar_descartado', user.username, String(clienteId) + ' -> ' + motivo);
    return { status: 'ok', clienteId: String(clienteId), motivo: motivo };
  } finally {
    lock.releaseLock();
  }
}

// Reactiva un cliente que se habia marcado como cerrado por error.
function quitarClienteDescartado(user, clienteId) {
  if (!clienteId) return { error: 'Falta clienteId' };
  var ss = getOrCreateSheet();
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    var hoja = ss.getSheetByName('ClientesDescartados');
    if (!hoja) return { error: 'No existe la hoja ClientesDescartados' };
    if (hoja.getLastRow() > 1) {
      var rango = hoja.getRange(2, 1, hoja.getLastRow() - 1, 1);
      var match = rango.createTextFinder(String(clienteId)).matchEntireCell(true).findNext();
      if (match) hoja.deleteRow(match.getRow());
    }
    registrarLog('quitar_descartado', user.username, String(clienteId));
    return { status: 'ok', clienteId: String(clienteId) };
  } finally {
    lock.releaseLock();
  }
}

function guardarNotas(ss, notas) {
  var hoja = ss.getSheetByName('Notas');
  if (hoja.getLastRow() > 1) hoja.getRange(2, 1, hoja.getLastRow() - 1, hoja.getLastColumn()).clear();
  var ahora = new Date();
  var filas = [];
  for (var id in notas) {
    if (notas[id]) filas.push([id, notas[id], ahora]);
  }
  if (filas.length > 0) hoja.getRange(2, 1, filas.length, 3).setValues(filas);
}
function guardarLlamadas(ss, llamadas) {
  var hoja = ss.getSheetByName('Llamadas');
  if (hoja.getLastRow() > 1) hoja.getRange(2, 1, hoja.getLastRow() - 1, hoja.getLastColumn()).clear();
  var filas = [];
  for (var id in llamadas) {
    var lista = llamadas[id] || [];
    for (var i = 0; i < lista.length; i++) {
      var l = lista[i];
      filas.push([id, l.fecha || '', l.hora || '', l.vendedor || '', l.resultado || '', l.nota || '', l.creado || '']);
    }
  }
  if (filas.length > 0) hoja.getRange(2, 1, filas.length, 7).setValues(filas);
}
// IMPORTANTE: esta funcion hace UPSERT (actualiza si el ID ya existe, agrega si es nuevo),
// nunca borra filas que no vengan en el array recibido. La hoja Recordatorios es compartida
// entre todos los vendedores; cada navegador tiene su propia copia local de USER.recordatorios
// que puede estar desactualizada. Antes esta funcion borraba TODA la hoja y la reescribia solo
// con la copia local de quien guardaba, lo que borraba recordatorios creados por otras sesiones
// o por otros vendedores. Para borrar un recordatorio puntual usar eliminarRecordatorio().
function guardarRecordatorios(ss, recordatorios) {
  var hoja = ss.getSheetByName('Recordatorios');
  if (!hoja || !recordatorios || recordatorios.length === 0) return;

  var data = hoja.getDataRange().getValues();
  var filaPorId = {};
  for (var i = 1; i < data.length; i++) {
    var idExistente = String(data[i][0] || '');
    if (idExistente) filaPorId[idExistente] = i + 1; // numero de fila real (1-indexado)
  }

  var filasNuevas = [];
  for (var j = 0; j < recordatorios.length; j++) {
    var r = recordatorios[j];
    if (!r || !r.id) continue;
    var valores = [r.id, r.clienteId || '', r.fecha || '', r.hora || '', r.descripcion || '', r.vendedor || '', r.completado === true, r.creado || '', r.accion || ''];
    if (filaPorId[r.id]) {
      hoja.getRange(filaPorId[r.id], 1, 1, 9).setValues([valores]);
    } else {
      filasNuevas.push(valores);
    }
  }
  if (filasNuevas.length > 0) {
    hoja.getRange(hoja.getLastRow() + 1, 1, filasNuevas.length, 9).setValues(filasNuevas);
  }
}

// Elimina UN recordatorio puntual por id (la unica forma de borrar, ya que
// guardarRecordatorios ya no borra por ausencia).
function eliminarRecordatorio(user, id) {
  if (!id) return { error: 'Falta id' };
  var ss = getOrCreateSheet();
  var hoja = ss.getSheetByName('Recordatorios');
  if (!hoja) return { error: 'No existe la hoja Recordatorios' };
  var data = hoja.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) {
      hoja.deleteRow(i + 1);
      registrarLog('eliminar_recordatorio', user.username, id);
      return { status: 'ok', id: id };
    }
  }
  return { error: 'No se encontró el recordatorio' };
}
function guardarTiposOverride(ss, tipos) {
  var hoja = ss.getSheetByName('TiposOverride');
  if (hoja.getLastRow() > 1) hoja.getRange(2, 1, hoja.getLastRow() - 1, hoja.getLastColumn()).clear();
  var ahora = new Date();
  var filas = [];
  for (var id in tipos) {
    if (tipos[id]) filas.push([id, tipos[id], ahora]);
  }
  if (filas.length > 0) hoja.getRange(2, 1, filas.length, 3).setValues(filas);
}
function guardarFeedback(ss, feedback) {
  var hoja = ss.getSheetByName('FeedbackProductos');
  if (hoja.getLastRow() > 1) hoja.getRange(2, 1, hoja.getLastRow() - 1, hoja.getLastColumn()).clear();
  var filas = [];
  for (var cid in feedback) {
    var prods = feedback[cid];
    for (var prod in prods) {
      var fb = prods[prod];
      filas.push([cid, prod, fb.tipo || '', fb.vendedor || '', fb.fecha || '']);
    }
  }
  if (filas.length > 0) hoja.getRange(2, 1, filas.length, 5).setValues(filas);
}
function guardarSugerencias(ss, sugerencias) {
  var hoja = ss.getSheetByName('Sugerencias');
  if (hoja.getLastRow() > 1) hoja.getRange(2, 1, hoja.getLastRow() - 1, hoja.getLastColumn()).clear();
  var filas = [];
  for (var i = 0; i < sugerencias.length; i++) {
    var s = sugerencias[i];
    filas.push([s.id || '', s.vendedor || '', s.fecha || '', s.texto || '', s.estado || 'nueva']);
  }
  if (filas.length > 0) hoja.getRange(2, 1, filas.length, 5).setValues(filas);
}

// ============================================================
// UTILIDADES (testing)
// ============================================================

// ============================================================
// CAPTURA RÁPIDA POR VOZ
// ============================================================

function probarConexion() {
  var ss = getOrCreateSheet();
  Logger.log('Sheet OK: ' + ss.getUrl());
  Logger.log('Usuarios: ' + listarUsuarios().length);
}

function abrirSheet() {
  var ss = getOrCreateSheet();
  Logger.log('URL: ' + ss.getUrl());
  return ss.getUrl();
}

function resetearTodoUsuarios() {
  // Funcion de emergencia: borra todos los usuarios y recrea los iniciales
  var ss = getOrCreateSheet();
  var hoja = ss.getSheetByName('Usuarios');
  if (hoja.getLastRow() > 1) hoja.getRange(2, 1, hoja.getLastRow() - 1, hoja.getLastColumn()).clear();
  asegurarUsuariosIniciales(ss);
  Logger.log('Usuarios reseteados a iniciales');
}

// ============================================================
// ====================== INTEGRACION SIIGO API ===============
// ============================================================

var SIIGO_BASE_URL = 'https://api.siigo.com';
var SIIGO_PARTNER_ID = 'FullCompanyApp';

// ============================================================
// CONFIGURACION INICIAL (ejecuta esta funcion UNA vez)
// ============================================================

/**
 * Configura las credenciales de Siigo.
 * IMPORTANTE: las credenciales se pegan directo aqui (sin pasar por chat)
 * 
 * COMO USAR:
 * 1. Edita las 2 lineas con TUS credenciales (NO me las pegues a mi)
 * 2. Ejecuta esta funcion UNA vez (boton Run)
 * 3. Borra las credenciales de este archivo (quedan guardadas en Properties)
 */
function configurarSiigo() {
  // ⚠️ PEGA AQUI TUS CREDENCIALES (luego borralas)
  var miUsername = 'PEGA_TU_USERNAME_AQUI';   // ej: fullcompany1@gmail.com
  var miAccessKey = 'PEGA_TU_ACCESS_KEY_AQUI'; // ej: MjczNzgz...
  
  if (miUsername === 'PEGA_TU_USERNAME_AQUI' || miAccessKey === 'PEGA_TU_ACCESS_KEY_AQUI') {
    throw new Error('Edita la funcion configurarSiigo() con tus credenciales antes de ejecutar');
  }
  
  var props = PropertiesService.getScriptProperties();
  props.setProperty('siigo_username', miUsername);
  props.setProperty('siigo_access_key', miAccessKey);
  // Borrar token cacheado si lo habia
  props.deleteProperty('siigo_token');
  props.deleteProperty('siigo_token_expira');
  
  Logger.log('Credenciales guardadas en Properties Service.');
  Logger.log('AHORA ejecuta probarConexionSiigoLog() para verificar.');
  Logger.log('Despues BORRA las credenciales de la funcion configurarSiigo()');
}

function probarConexionSiigoLog() {
  var r = probarConexionSiigo();
  Logger.log(JSON.stringify(r, null, 2));
}

// ============================================================
// AUTENTICACION
// ============================================================

function siigoAuth(force) {
  var props = PropertiesService.getScriptProperties();
  
  if (!force) {
    var cachedToken = props.getProperty('siigo_token');
    var cachedExpira = props.getProperty('siigo_token_expira');
    if (cachedToken && cachedExpira && new Date(cachedExpira) > new Date()) {
      return cachedToken;
    }
  }
  
  var username = props.getProperty('siigo_username');
  var accessKey = props.getProperty('siigo_access_key');
  if (!username || !accessKey) {
    throw new Error('Credenciales Siigo no configuradas. Ejecuta configurarSiigo() primero.');
  }
  
  var response = UrlFetchApp.fetch(SIIGO_BASE_URL + '/auth', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ username: username, access_key: accessKey }),
    muteHttpExceptions: true,
  });
  
  var code = response.getResponseCode();
  if (code !== 200) {
    throw new Error('Auth Siigo fallida (HTTP ' + code + '): ' + response.getContentText());
  }
  
  var data = JSON.parse(response.getContentText());
  var token = data.access_token;
  var expira = new Date(Date.now() + (data.expires_in || 86400) * 1000 - 60000); // 1 min antes
  
  props.setProperty('siigo_token', token);
  props.setProperty('siigo_token_expira', expira.toISOString());
  
  return token;
}

function siigoApi(path, queryParams, _intentos) {
  _intentos = _intentos || 0;
  var token = siigoAuth();
  var url = SIIGO_BASE_URL + path;
  
  if (queryParams) {
    var qs = [];
    for (var k in queryParams) {
      qs.push(encodeURIComponent(k) + '=' + encodeURIComponent(queryParams[k]));
    }
    if (qs.length > 0) url += (url.indexOf('?')>=0?'&':'?') + qs.join('&');
  }
  
  var response = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Partner-Id': SIIGO_PARTNER_ID,
    },
    muteHttpExceptions: true,
  });
  
  var code = response.getResponseCode();
  
  // Token expirado: refrescar y reintentar
  if (code === 401 && _intentos < 2) {
    siigoAuth(true);
    return siigoApi(path, queryParams, _intentos + 1);
  }
  
  // Rate limit (HTTP 429): esperar el tiempo indicado y reintentar
  if (code === 429) {
    var contenido = response.getContentText();
    var match = contenido.match(/(\d+)\s*seconds?/i);
    var esperaSeg = match ? parseInt(match[1]) : 15;
    Utilities.sleep((esperaSeg + 2) * 1000);
    return siigoApi(path, queryParams, _intentos);
  }
  
  // Error 500/502/503 del servidor de Siigo: reintentar hasta 2 veces (suele ser temporal)
  if ((code === 500 || code === 502 || code === 503) && _intentos < 2) {
    Utilities.sleep(3000);
    return siigoApi(path, queryParams, _intentos + 1);
  }
  
  if (code !== 200) {
    throw new Error('Siigo API error (HTTP ' + code + ') en ' + path + ': ' + response.getContentText().substring(0, 300));
  }
  
  return JSON.parse(response.getContentText());
}

function siigoFetchAll(path, queryParams, maxPages) {
  var all = [];
  var page = 1;
  var pageSize = 100;
  var maxP = maxPages || 200; // safety: max 20K resultados
  
  while (page <= maxP) {
    var params = {};
    if (queryParams) for (var k in queryParams) params[k] = queryParams[k];
    params.page = page;
    params.page_size = pageSize;
    
    var data = siigoApi(path, params);
    if (!data.results || data.results.length === 0) break;
    
    all = all.concat(data.results);
    if (data.results.length < pageSize) break;
    page++;
    
    // Pausa entre paginas para no saturar el rate limit
    Utilities.sleep(500);
  }
  
  return all;
}

// ============================================================
// SINCRONIZACION
// ============================================================

function ejecutarSincronizacion(tipo, adminUser) {
  var inicio = new Date();
  var stats = { inicio: inicio.toISOString() };
  var esRapido = (tipo === 'rapido');
  
  try {
    if (tipo === 'todo' || tipo === 'vendedores') {
      stats.vendedores = sincronizarVendedoresSiigo();
    }
  } catch (e) {
    stats.error_vendedores = e.message;
  }
  
  try {
    if (tipo === 'todo' || tipo === 'productos') {
      stats.productos = sincronizarProductosSiigo();
    }
  } catch (e) {
    stats.error_productos = e.message;
  }
  
  try {
    if (tipo === 'todo' || tipo === 'clientes') {
      stats.clientes = sincronizarClientesSiigo();
    }
  } catch (e) {
    stats.error_clientes = e.message;
  }
  
  try {
    if (tipo === 'todo' || tipo === 'facturas' || esRapido) {
      stats.facturas = sincronizarFacturasSiigo();
    }
  } catch (e) {
    stats.error_facturas = e.message;
  }
  
  try {
    if (tipo === 'todo' || tipo === 'cotizaciones' || esRapido) {
      stats.cotizaciones = esRapido ? sincronizarCotizacionesSiigo(obtenerFechaHaceDias(60), true) : sincronizarCotizacionesSiigo();
    }
  } catch (e) {
    stats.error_cotizaciones = e.message;
  }
  
  try {
    if (tipo === 'todo' || tipo === 'cartera' || esRapido) {
      stats.cartera = sincronizarCarteraSiigo();
    }
  } catch (e) {
    stats.error_cartera = e.message;
  }
  
  // Tras sincronizar todo, re-procesar los clientes para la app
  try {
    if (tipo === 'todo' || tipo === 'clientes' || tipo === 'facturas' || esRapido) {
      stats.procesamiento = procesarClientesSiigo();
    }
  } catch (e) {
    stats.error_procesamiento = e.message;
  }

  // Precalcular resumen diario de ventas para que la carrera cargue rápido.
  try {
    if (tipo === 'todo' || tipo === 'facturas' || esRapido) {
      stats.carrera = esRapido ? actualizarResumenCarreraHoyDesdeSiigo() : reconstruirVentasVendedorDia();
    }
  } catch (e) {
    stats.error_carrera = e.message;
  }
  
  stats.duracion_seg = Math.round((Date.now() - inicio.getTime()) / 1000);
  
  var props = PropertiesService.getScriptProperties();
  props.setProperty('siigo_ultima_sync', inicio.toISOString());
  props.setProperty('siigo_ultimo_resultado', JSON.stringify(stats));
  
  // Guardar en hoja
  var ss = getOrCreateSheet();
  var hoja = ss.getSheetByName('SiigoEstadoSync');
  var hayError = stats.error_vendedores || stats.error_clientes || stats.error_facturas || stats.error_productos || stats.error_cotizaciones || stats.error_cartera;
  hoja.appendRow([inicio, tipo, hayError ? 'error' : 'ok', JSON.stringify(stats).substring(0, 5000)]);
  
  // Limitar log
  var rows = hoja.getLastRow();
  if (rows > 501) hoja.deleteRows(2, rows - 501);
  
  registrarLog('siigo_sync', (adminUser && adminUser.username) || 'sistema', 'tipo=' + tipo + ' duracion=' + stats.duracion_seg + 's');
  
  return stats;
}

function sincronizarTodo() {
  var props = PropertiesService.getScriptProperties();
  var ahora = new Date();

  // Clientes: solo UNA VEZ AL DIA (no cada hora).
  // Con 10k+ clientes la descarga completa consume casi todo el tiempo disponible.
  // Los clientes nuevos que lleguen via factura se jalan puntualmente abajo.
  var ultimaClientes = props.getProperty('siigo_ultima_sync_clientes') || '';
  var haceHorasClientes = ultimaClientes ? (ahora.getTime() - new Date(ultimaClientes).getTime()) / 3600000 : 999;
  if (haceHorasClientes >= 24) {
    try {
      sincronizarClientesSiigo();
      props.setProperty('siigo_ultima_sync_clientes', ahora.toISOString());
    } catch(e) { Logger.log('sincronizarTodo clientes: ' + e); }
    return; // Deja facturas, cotizaciones y reprocesamiento para el siguiente ciclo.
  }

  // Facturas: solo las ultimas 4 horas (no 90 dias).
  // El sync es incremental (no duplica), ventana corta = rapido y sin timeout.
  var hace4h = new Date(ahora.getTime() - 4 * 3600000);
  var desde4h = hace4h.toISOString().split('T')[0];
  var resultFacturas;
  try {
    resultFacturas = sincronizarFacturasSiigo(desde4h);
  } catch(e) { Logger.log('sincronizarTodo facturas: ' + e); }

  // Si entraron facturas nuevas, buscar puntualmente si el cliente es nuevo
  // para agregarlo a SiigoClientes sin tener que re-descargar los 10k+.
  if (resultFacturas && resultFacturas.nuevas > 0) {
    try { sincronizarClientesNuevosDesdeFacturas(); } catch(e) { Logger.log('nuevos clientes: ' + e); }
  }

  // Cotizaciones: ultimos 7 dias (incremental, rapido).
  try {
    sincronizarCotizacionesSiigo(obtenerFechaHaceDias(7), true);
  } catch(e) { Logger.log('sincronizarTodo cotizaciones: ' + e); }

  // Reprocesar para que la app vea los cambios.
  try {
    procesarClientesSiigo();
  } catch(e) { Logger.log('sincronizarTodo procesamiento: ' + e); }
}

// Despues de sincronizar facturas recientes, revisa si algun ClienteId de esas
// facturas no existe aun en SiigoClientes y lo jala puntualmente de la API de Siigo.
// Asi un cliente nuevo aparece en la app en la proxima sincronizacion horaria
// sin tener que re-descargar los 10k+ clientes completos.
function sincronizarClientesNuevosDesdeFacturas() {
  var ss = getOrCreateSheet();
  var hojaC = ss.getSheetByName('SiigoClientes');
  var hojaF = ss.getSheetByName('SiigoFacturas');
  if (!hojaC || !hojaF || hojaF.getLastRow() < 2) return { nuevos: 0 };

  // IDs ya en SiigoClientes
  var existentes = {};
  if (hojaC.getLastRow() > 1) {
    var dataC = hojaC.getRange(2, 1, hojaC.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < dataC.length; i++) existentes[String(dataC[i][0])] = true;
  }

  // Revisar las ultimas 100 filas de SiigoFacturas (ClienteId = col 5)
  var lastRow = hojaF.getLastRow();
  var checkRows = Math.min(100, lastRow - 1);
  var dataF = hojaF.getRange(lastRow - checkRows + 1, 5, checkRows, 1).getValues();
  var faltantes = {};
  for (var j = 0; j < dataF.length; j++) {
    var cid = String(dataF[j][0] || '');
    if (cid && !existentes[cid]) faltantes[cid] = true;
  }

  var ids = Object.keys(faltantes);
  if (ids.length === 0) return { nuevos: 0 };

  var ahora = new Date();
  var nuevasFilas = [];
  for (var k = 0; k < ids.length; k++) {
    try {
      var c = siigoApi('/v1/customers/' + ids[k]);
      if (!c || !c.id) continue;
      var nombre = Array.isArray(c.name) ? c.name.join(' ').trim() : String(c.name || '').trim();
      if (c.commercial_name) nombre = c.commercial_name + (nombre ? ' (' + nombre + ')' : '');
      var ciudad = c.address ? (c.address.city ? (c.address.city.name || c.address.city.city_name || '') : '') : '';
      var dir = c.address ? (c.address.address || '') : '';
      var tel = c.phones && c.phones.length > 0 ? ((c.phones[0].indicative || '') + (c.phones[0].number || '')) : '';
      var email = c.contacts && c.contacts.length > 0 ? (c.contacts[0].email || '') : '';
      nuevasFilas.push([
        String(c.id || ''), String(c.identification || ''), nombre, String(c.person_type || ''),
        c.active !== false, ciudad, dir, tel, email,
        String(c.related_users && c.related_users[0] ? c.related_users[0].id : (c.seller || '')),
        '', 0, ahora
      ]);
    } catch(ex) { Logger.log('Error jalando cliente ' + ids[k] + ': ' + ex); }
  }

  if (nuevasFilas.length > 0) {
    var start = hojaC.getLastRow() + 1;
    hojaC.getRange(start, 1, nuevasFilas.length, 13).setValues(nuevasFilas);
  }

  Logger.log('Clientes nuevos jalados puntualmente: ' + nuevasFilas.length);
  return { nuevos: nuevasFilas.length };
}

// ============================================================
// LIMPIEZA PARA RESINCRONIZAR: borra de SiigoFacturas + SiigoFacturaItems
// las filas de facturas fechadas en los ultimos N dias, para que la proxima
// ejecucion de sincronizarFacturasSiigo las vuelva a importar con el calculo
// de precios CORREGIDO. Solo modifica las hojas locales, no llama a Siigo.
//
// Pasos:
//   1. Seleccionar esta funcion y Run → borra las filas recientes
//   2. Seleccionar sincronizarFacturasSiigo y Run → las reimporta correctamente
//   3. Seleccionar procesarClientesSiigo y Run → actualiza la app
// ============================================================
// ============================================================
// CORRECCIÓN HISTÓRICA: facturas sin IVA importadas con ×1.19 erróneo.
// Busca en SiigoFacturas todas las facturas donde Impuestos = 0,
// y divide entre 1.19 el Total y el PrecioUnit de sus ítems en SiigoFacturaItems.
// Ejecutar UNA VEZ desde el editor después de actualizar calcularTotalConIvaItemSiigo.
// Luego correr procesarClientesSiigo para que la app refleje los valores corregidos.
// ============================================================
function corregirFacturasSinIVA() {
  var ss = getOrCreateSheet();
  var hojaF = ss.getSheetByName('SiigoFacturas');
  var hojaI = ss.getSheetByName('SiigoFacturaItems');

  // SiigoFacturas columnas: IdSiigo(0), Numero(1), Fecha(2), TipoDoc(3), ClienteId(4),
  // ClienteIdentificacion(5), VendedorId(6), Vendedor(7), Subtotal(8), Descuento(9),
  // Impuestos(10), Total(11), Estado(12), Actualizado(13), PublicUrl(14)
  var dataF = hojaF.getDataRange().getValues();
  var sinIva = {};
  for (var i = 1; i < dataF.length; i++) {
    if (Number(dataF[i][10] || 0) === 0) {
      sinIva[String(dataF[i][0])] = true;
    }
  }
  Logger.log('Facturas sin IVA encontradas: ' + Object.keys(sinIva).length);

  if (hojaI.getLastRow() < 2) { Logger.log('Sin ítems que corregir.'); return { corregidos: 0 }; }

  // SiigoFacturaItems: FacturaId(0), Producto(1), Codigo(2), Cantidad(3), PrecioUnit(4), Descuento(5), Total(6)
  var dataI = hojaI.getRange(2, 1, hojaI.getLastRow() - 1, 7).getValues();
  var corregidos = 0;
  for (var j = 0; j < dataI.length; j++) {
    if (!sinIva[String(dataI[j][0])]) continue;
    var cantidad = Number(dataI[j][3] || 0);
    var totalActual = Number(dataI[j][6] || 0);
    if (cantidad > 0 && totalActual > 0) {
      var totalCorrecto = Math.round(totalActual / 1.19);
      dataI[j][4] = Math.round(totalCorrecto / cantidad); // PrecioUnit
      dataI[j][6] = totalCorrecto;                        // Total
      corregidos++;
    }
  }

  hojaI.getRange(2, 1, dataI.length, 7).setValues(dataI);
  Logger.log('Ítems corregidos: ' + corregidos);
  return { facturasAfectadas: Object.keys(sinIva).length, itemsCorregidos: corregidos };
}

// ============================================================
// REIMPORTACIÓN FACTURAS CON IVA
// Las facturas con IVA importadas con código viejo tienen PrecioUnit y Total
// almacenados como pre-IVA (el código viejo no sumaba el impuesto al total).
// Esta función elimina SOLO las facturas con Impuestos > 0 de las hojas,
// conservando intactas las sin IVA (ya corregidas por corregirFacturasSinIVA).
// Después hay que correr sincronizarHistorialCompleto (puede requerir varias
// ejecuciones) y luego procesarClientesSiigo.
//
// Orden:
//   1. Ejecutar prepararReimportacionFacturasConIVA  ← una sola vez
//   2. Ejecutar sincronizarHistorialCompleto          ← repetir hasta que diga COMPLETO
//   3. Ejecutar procesarClientesSiigo                ← una vez al final
// ============================================================
// ============================================================
// CORRECCIÓN HISTÓRICA: facturas CON IVA almacenadas con Total pre-IVA.
// Siigo entrega it.total como subtotal PRE-IVA por línea y taxes[].value como
// el monto del IVA. El código antiguo guardaba solo it.total (sin sumar el IVA),
// por lo que PrecioUnit y Total en SiigoFacturaItems quedaron como pre-IVA.
//
// Esta función toma la tasa de IVA del encabezado de cada factura
// (Impuestos / Subtotal desde SiigoFacturas) y la aplica a los ítems almacenados.
// Solo toca facturas donde Impuestos > 0 (es decir, facturas que SÍ tienen IVA).
//
// Ejecutar UNA VEZ, LUEGO de pegar el código corregido.
// Después correr procesarClientesSiigo para que la app refleje los cambios.
// ============================================================
function corregirFacturasConIVA() {
  var ss = getOrCreateSheet();
  var hojaF = ss.getSheetByName('SiigoFacturas');
  var hojaI = ss.getSheetByName('SiigoFacturaItems');

  // SiigoFacturas: IdSiigo(0), Subtotal(8), Impuestos(10)
  var dataF = hojaF.getDataRange().getValues();
  var tasaIVA = {}; // facturaId → tasa (ej. 0.19)
  for (var i = 1; i < dataF.length; i++) {
    var subtotal  = Number(dataF[i][8]  || 0);
    var impuestos = Number(dataF[i][10] || 0);
    if (subtotal > 0 && impuestos > 0) {
      tasaIVA[String(dataF[i][0])] = impuestos / subtotal;
    }
  }
  Logger.log('Facturas con IVA encontradas: ' + Object.keys(tasaIVA).length);

  if (hojaI.getLastRow() < 2) { Logger.log('Sin ítems en SiigoFacturaItems.'); return { corregidos: 0 }; }

  // SiigoFacturaItems: FacturaId(0), Producto(1), Codigo(2), Cantidad(3), PrecioUnit(4), Descuento(5), Total(6)
  var dataI = hojaI.getRange(2, 1, hojaI.getLastRow() - 1, 7).getValues();
  var corregidos = 0;
  for (var j = 0; j < dataI.length; j++) {
    var fid  = String(dataI[j][0]);
    var tasa = tasaIVA[fid];
    if (!tasa) continue; // sin IVA → no tocar
    var cantidad     = Number(dataI[j][3] || 0);
    var totalActual  = Number(dataI[j][6] || 0);
    if (cantidad > 0 && totalActual > 0) {
      var totalConIVA = Math.round(totalActual * (1 + tasa));
      dataI[j][4] = Math.round(totalConIVA / cantidad); // PrecioUnit
      dataI[j][6] = totalConIVA;                        // Total
      corregidos++;
    }
  }

  hojaI.getRange(2, 1, dataI.length, 7).setValues(dataI);
  Logger.log('Ítems con IVA corregidos: ' + corregidos);
  return { facturasAfectadas: Object.keys(tasaIVA).length, itemsCorregidos: corregidos };
}

// ============================================================
// CORRECCIÓN HISTÓRICA: cotizaciones CON IVA almacenadas con Total/PrecioUnit pre-IVA.
// Paralela a corregirFacturasConIVA pero para SiigoCotizaciones / SiigoCotizacionItems.
// SiigoCotizaciones: IdSiigo(0), Subtotal(7), Impuestos(9)
// SiigoCotizacionItems: CotizacionId(0), Producto(1), Codigo(2), Cantidad(3), PrecioUnitIVA(4), Descuento(5), Total(6)
//
// Ejecutar UNA VEZ desde el editor → Run → corregirCotizacionesConIVA
// Después correr procesarClientesSiigo para que la app refleje los cambios.
// ============================================================
function corregirCotizacionesConIVA() {
  var ss = getOrCreateSheet();
  var hojaC = ss.getSheetByName('SiigoCotizaciones');
  var hojaI = ss.getSheetByName('SiigoCotizacionItems');

  if (!hojaC || hojaC.getLastRow() < 2) {
    Logger.log('No hay cotizaciones en SiigoCotizaciones.');
    return { cotizacionesAfectadas: 0, itemsCorregidos: 0 };
  }

  // SiigoCotizaciones: IdSiigo(0), Subtotal(7), Impuestos(9)
  var dataC = hojaC.getDataRange().getValues();
  var tasaIVA = {}; // cotizacionId → tasa (ej. 0.19)
  for (var i = 1; i < dataC.length; i++) {
    var subtotal  = Number(dataC[i][7]  || 0);
    var impuestos = Number(dataC[i][9] || 0);
    if (subtotal > 0 && impuestos > 0) {
      tasaIVA[String(dataC[i][0])] = impuestos / subtotal;
    }
  }
  Logger.log('Cotizaciones con IVA encontradas: ' + Object.keys(tasaIVA).length);

  if (!hojaI || hojaI.getLastRow() < 2) {
    Logger.log('Sin ítems en SiigoCotizacionItems.');
    return { cotizacionesAfectadas: Object.keys(tasaIVA).length, itemsCorregidos: 0 };
  }

  // SiigoCotizacionItems: CotizacionId(0), Producto(1), Codigo(2), Cantidad(3), PrecioUnitIVA(4), Descuento(5), Total(6)
  var dataI = hojaI.getRange(2, 1, hojaI.getLastRow() - 1, 7).getValues();
  var corregidos = 0;
  for (var j = 0; j < dataI.length; j++) {
    var cid  = String(dataI[j][0]);
    var tasa = tasaIVA[cid];
    if (!tasa) continue; // sin IVA → no tocar
    var cantidad    = Number(dataI[j][3] || 0);
    var totalActual = Number(dataI[j][6] || 0);
    if (cantidad > 0 && totalActual > 0) {
      var totalConIVA = Math.round(totalActual * (1 + tasa));
      dataI[j][4] = Math.round(totalConIVA / cantidad); // PrecioUnitIVA
      dataI[j][6] = totalConIVA;                        // Total
      corregidos++;
    }
  }

  hojaI.getRange(2, 1, dataI.length, 7).setValues(dataI);
  Logger.log('Ítems de cotizaciones con IVA corregidos: ' + corregidos);
  return { cotizacionesAfectadas: Object.keys(tasaIVA).length, itemsCorregidos: corregidos };
}

function prepararReimportacionFacturasConIVA() {
  var ss = getOrCreateSheet();
  var hojaF = ss.getSheetByName('SiigoFacturas');
  var hojaI = ss.getSheetByName('SiigoFacturaItems');

  // Leer todas las facturas y separar con/sin IVA
  var dataF = hojaF.getDataRange().getValues();
  var idsConIVA = {};
  var filasQuedan = [dataF[0]]; // conservar cabecera
  for (var i = 1; i < dataF.length; i++) {
    var impuestos = Number(dataF[i][10] || 0); // col 10 = Impuestos
    if (impuestos > 0) {
      idsConIVA[String(dataF[i][0])] = true;   // marcar para borrar
    } else {
      filasQuedan.push(dataF[i]);               // conservar sin IVA
    }
  }

  // Reconstruir SiigoFacturas sin las facturas con IVA
  hojaF.clearContents();
  hojaF.getRange(1, 1, filasQuedan.length, filasQuedan[0].length).setValues(filasQuedan);

  // Borrar ítems de las facturas con IVA en SiigoFacturaItems
  var itemsQuedan = [];
  if (hojaI.getLastRow() > 1) {
    var dataI = hojaI.getDataRange().getValues();
    itemsQuedan = [dataI[0]]; // conservar cabecera
    for (var j = 1; j < dataI.length; j++) {
      if (!idsConIVA[String(dataI[j][0])]) itemsQuedan.push(dataI[j]);
    }
    hojaI.clearContents();
    hojaI.getRange(1, 1, itemsQuedan.length, itemsQuedan[0].length).setValues(itemsQuedan);
  }

  // Reiniciar cursor del historial para que sincronizarHistorialCompleto empiece desde hoy
  var props = PropertiesService.getScriptProperties();
  props.deleteProperty('siigo_historial_cursor');
  props.deleteProperty('siigo_historial_vacios');
  props.deleteProperty('siigo_historial_completo');

  var eliminadas = Object.keys(idsConIVA).length;
  var conservadas = filasQuedan.length - 1;
  Logger.log('Facturas con IVA eliminadas para reimportación: ' + eliminadas);
  Logger.log('Facturas sin IVA conservadas: ' + conservadas);
  Logger.log('Items restantes: ' + (itemsQuedan.length ? itemsQuedan.length - 1 : 0));
  Logger.log('→ Ahora corre sincronizarHistorialCompleto (varias veces si es necesario).');
  Logger.log('→ Al terminar, corre procesarClientesSiigo.');
  return {
    eliminadas: eliminadas,
    conservadas: conservadas,
    mensaje: 'Listo. Corre sincronizarHistorialCompleto hasta que diga COMPLETO, luego procesarClientesSiigo.'
  };
}

function limpiarFacturasRecientes(diasAtras) {
  diasAtras = diasAtras || 30;
  var fechaCorte = new Date();
  fechaCorte.setDate(fechaCorte.getDate() - diasAtras);
  var fechaCorteStr = fechaCorte.toISOString().split('T')[0];

  var ss = getOrCreateSheet();
  var hojaF = ss.getSheetByName('SiigoFacturas');
  var hojaI = ss.getSheetByName('SiigoFacturaItems');

  var dataF = hojaF.getDataRange().getValues();
  var mantenerF = [dataF[0]];
  var idsEliminar = {};
  for (var i = 1; i < dataF.length; i++) {
    var fechaFila = String(dataF[i][2] || '').substring(0, 10);
    if (fechaFila >= fechaCorteStr) {
      idsEliminar[String(dataF[i][0])] = true;
    } else {
      mantenerF.push(dataF[i]);
    }
  }
  hojaF.clearContents();
  if (mantenerF.length > 0) hojaF.getRange(1, 1, mantenerF.length, mantenerF[0].length).setValues(mantenerF);

  var dataI = hojaI.getDataRange().getValues();
  var mantenerI = [dataI[0]];
  for (var j = 1; j < dataI.length; j++) {
    if (!idsEliminar[String(dataI[j][0])]) mantenerI.push(dataI[j]);
  }
  hojaI.clearContents();
  if (mantenerI.length > 0) hojaI.getRange(1, 1, mantenerI.length, mantenerI[0].length).setValues(mantenerI);

  var resumen = {
    desde: fechaCorteStr,
    facturasEliminadas: dataF.length - mantenerF.length,
    itemsEliminados: dataI.length - mantenerI.length
  };
  Logger.log('limpiarFacturasRecientes: ' + JSON.stringify(resumen));
  return resumen;
}

// ----- VENDEDORES -----
function sincronizarVendedoresSiigo() {
  var data = siigoApi('/v1/users');
  var usuariosSiigo = data.results || data || [];
  
  // Filtrar: solo activos y usuarios REALES (no puntos de venta ni pagina web)
  var filtrados = [];
  for (var i = 0; i < usuariosSiigo.length; i++) {
    var u = usuariosSiigo[i];
    if (u.active === false) continue;  // saltar desactivados
    
    var nombreCompleto = ((u.first_name || '') + ' ' + (u.last_name || '') + ' ' + (u.username || '')).toUpperCase();
    var excluir = ['PUNTO DE VENTA', 'PUNTO VENTA', 'PAGINA WEB', 'PÁGINA WEB', 'POS', 'F PUNTO', 'PUNTO_VENTA'];
    var skip = false;
    for (var e = 0; e < excluir.length; e++) {
      if (nombreCompleto.indexOf(excluir[e]) !== -1) { skip = true; break; }
    }
    if (skip) continue;
    
    filtrados.push(u);
  }
  
  var ss = getOrCreateSheet();
  var hoja = ss.getSheetByName('Usuarios');
  var rows = hoja.getDataRange().getValues();
  
  // Mapear usuarios actuales por siigoUserId
  var actuales = {}; // siigoUserId -> {row, data}
  for (var i = 1; i < rows.length; i++) {
    var sid = String(rows[i][11] || ''); // columna SiigoUserId
    if (sid) actuales[sid] = { row: i + 1, data: rows[i] };
  }
  
  var idsEnSiigo = {};
  var creados = 0;
  var actualizados = 0;
  var desactivados = 0;
  
  for (var i = 0; i < filtrados.length; i++) {
    var u = filtrados[i];
    var sid = String(u.id || u.identification || '');
    if (!sid) continue;
    idsEnSiigo[sid] = true;
    
    var nombre = (u.first_name ? u.first_name + ' ' : '') + (u.last_name || u.username || '');
    nombre = nombre.trim() || u.username || ('Vendedor ' + sid);
    
    if (actuales[sid]) {
      // Existe: actualizar nombre si cambió
      var fila = actuales[sid];
      if (fila.data[1] !== nombre) {
        hoja.getRange(fila.row, 2).setValue(nombre);
        actualizados++;
      }
    } else {
      // Nuevo de Siigo: crear con contraseña aleatoria imposible
      // Usar primer nombre + primer apellido (ej: oscarsanchez)
      var primerNombre = String(u.first_name || '').trim().split(/\s+/)[0] || '';
      var primerApellido = String(u.last_name || '').trim().split(/\s+/)[0] || '';
      var nombreParaUsername = (primerNombre + primerApellido) || u.username || ('siigo_' + sid);
      var username = nombreParaUsername.toLowerCase()
        .replace(/[áàäâã]/g, 'a').replace(/[éèëê]/g, 'e').replace(/[íìïî]/g, 'i')
        .replace(/[óòöôõ]/g, 'o').replace(/[úùüû]/g, 'u').replace(/ñ/g, 'n')
        .replace(/[^a-z0-9]/g, '');
      var pwdRandom = Utilities.getUuid() + Utilities.getUuid(); // pwd imposible
      
      // Verificar que el username no exista ya
      var existe = false;
      for (var j = 1; j < rows.length; j++) {
        if (String(rows[j][0]).toLowerCase() === username) { existe = true; break; }
      }
      if (existe) username = username + '_' + sid;
      
      crearUsuarioInterno(ss, username, nombre, 'vendedor_hogar', pwdRandom, 'siigo', sid);
      creados++;
    }
  }
  
  // Desactivar usuarios de origen siigo que ya no estan en Siigo
  for (var sid in actuales) {
    if (!idsEnSiigo[sid]) {
      var fila = actuales[sid];
      var origen = String(fila.data[10] || '');
      var activoActual = !!fila.data[6];
      if (origen === 'siigo' && activoActual) {
        hoja.getRange(fila.row, 7).setValue(false);
        hoja.getRange(fila.row, 8).setValue('');
        hoja.getRange(fila.row, 9).setValue('');
        desactivados++;
      }
    }
  }
  
  return {
    total_recibidos: usuariosSiigo.length,
    filtrados_validos: filtrados.length,
    creados: creados,
    actualizados: actualizados,
    desactivados: desactivados,
  };
}

// ----- LIMPIAR USUARIOS SIIGO INCORRECTOS -----
// Ejecutar manualmente desde el editor si hay usuarios mal creados.
// Borra TODOS los usuarios de origen 'siigo' (NO toca los manuales como oscar, neider, etc.)
function limpiarUsuariosSiigoIncorrectos() {
  var ss = getOrCreateSheet();
  var hoja = ss.getSheetByName('Usuarios');
  var data = hoja.getDataRange().getValues();
  var eliminados = 0;
  
  for (var i = data.length - 1; i >= 1; i--) {
    var origen = String(data[i][10] || '');
    if (origen === 'siigo') {
      hoja.deleteRow(i + 1);
      eliminados++;
    }
  }
  
  Logger.log('Usuarios Siigo eliminados: ' + eliminados);
  return { eliminados: eliminados };
}

// ----- DEJAR SOLO OSCAR, NEIDER Y LOS DE SIIGO -----
// Borra todos los usuarios manuales EXCEPTO oscar y neider.
// Tambien elimina duplicados (mismo username repetido).
// Ejecutar manualmente desde el editor.
function limpiarDejarOscarNeiderYSiigo() {
  var ss = getOrCreateSheet();
  var hoja = ss.getSheetByName('Usuarios');
  var data = hoja.getDataRange().getValues();
  var eliminados = 0;
  var vistos = {};
  
  // Recorrer de abajo hacia arriba para no romper indices
  for (var i = data.length - 1; i >= 1; i--) {
    var username = String(data[i][0] || '').toLowerCase();
    var origen = String(data[i][10] || '');
    
    if (!username) {
      // Fila vacia: borrar
      hoja.deleteRow(i + 1);
      eliminados++;
      continue;
    }
    
    var esOscarManual = (username === 'oscar' && origen === 'manual');
    var esNeiderManual = (username === 'neider' && origen === 'manual');
    var esSiigo = (origen === 'siigo');
    var mantener = esOscarManual || esNeiderManual || esSiigo;
    
    // Si ya vimos este username (duplicado) o no es de los que mantenemos: borrar
    if (!mantener || vistos[username]) {
      hoja.deleteRow(i + 1);
      eliminados++;
    } else {
      vistos[username] = true;
    }
  }
  
  Logger.log('Usuarios eliminados: ' + eliminados);
  Logger.log('Quedaron: oscar, neider y los de Siigo');
  return { eliminados: eliminados };
}

// ----- PRODUCTOS -----
function sincronizarProductosSiigo() {
  var productos = siigoFetchAll('/v1/products', {}, 100);
  
  var ss = getOrCreateSheet();
  var hoja = ss.getSheetByName('SiigoProductos');
  
  // Limpiar y reescribir (es rapido para productos)
  if (hoja.getLastRow() > 1) hoja.getRange(2, 1, hoja.getLastRow() - 1, hoja.getLastColumn()).clear();
  
  var ahora = new Date();
  var filas = [];
  for (var i = 0; i < productos.length; i++) {
    var p = productos[i];
    var precio = 0;
    if (p.prices && p.prices.length > 0 && p.prices[0].price_list && p.prices[0].price_list.length > 0) {
      precio = p.prices[0].price_list[0].value || 0;
    }
    filas.push([
      String(p.id || ''),
      String(p.code || ''),
      String(p.name || ''),
      precio,
      p.account_group ? String(p.account_group.name || '') : '',
      p.active !== false,
      ahora
    ]);
  }
  
  if (filas.length > 0) {
    // Batch write en chunks de 1000
    for (var i = 0; i < filas.length; i += 1000) {
      var chunk = filas.slice(i, i + 1000);
      hoja.getRange(i + 2, 1, chunk.length, 7).setValues(chunk);
    }
  }
  
  return { total: productos.length };
}

// ----- CLIENTES (TERCEROS) -----
function sincronizarClientesSiigo() {
  var clientes = siigoFetchAll('/v1/customers', {}, 200);
  
  var ss = getOrCreateSheet();
  var hoja = ss.getSheetByName('SiigoClientes');
  
  if (hoja.getLastRow() > 1) hoja.getRange(2, 1, hoja.getLastRow() - 1, hoja.getLastColumn()).clear();
  
  var ahora = new Date();
  var filas = [];
  for (var i = 0; i < clientes.length; i++) {
    var c = clientes[i];
    
    // Nombre puede ser array (persona) o string (empresa)
    var nombre = '';
    if (Array.isArray(c.name)) nombre = c.name.join(' ').trim();
    else if (c.name) nombre = String(c.name).trim();
    if (c.commercial_name) nombre = c.commercial_name + (nombre ? ' (' + nombre + ')' : '');
    
    var ciudad = '';
    var direccion = '';
    if (c.address) {
      direccion = c.address.address || '';
      if (c.address.city) ciudad = c.address.city.name || c.address.city.city_name || '';
    }
    
    var telefono = '';
    if (c.phones && c.phones.length > 0) {
      var p = c.phones[0];
      telefono = (p.indicative || '') + (p.number || '');
    }
    
    var email = '';
    if (c.contacts && c.contacts.length > 0) email = c.contacts[0].email || '';
    
    filas.push([
      String(c.id || ''),
      String(c.identification || ''),
      nombre,
      String(c.person_type || ''),
      c.active !== false,
      ciudad,
      direccion,
      telefono,
      email,
      String(c.related_users && c.related_users[0] ? c.related_users[0].id : (c.seller || '')),
      '', // UltimaCompra: se llena al sync facturas
      0,  // TotalFacturado: idem
      ahora
    ]);
  }
  
  if (filas.length > 0) {
    for (var i = 0; i < filas.length; i += 1000) {
      var chunk = filas.slice(i, i + 1000);
      hoja.getRange(i + 2, 1, chunk.length, 13).setValues(chunk);
    }
  }
  
  return { total: clientes.length };
}

// ----- FACTURAS -----
function sincronizarFacturasSiigo(fechaDesde) {
  // Sync regular: trae facturas recientes y las ACUMULA (sin borrar el historial).
  // Por defecto ultimos 90 dias.
  if (!fechaDesde) {
    var d = new Date();
    d.setDate(d.getDate() - 90);
    fechaDesde = d.toISOString().split('T')[0];
  }
  var manana = new Date();
  manana.setDate(manana.getDate() + 1);
  var hasta = manana.toISOString().split('T')[0];
  
  // Usa la misma logica de acumular sin duplicar (NO borra el historial)
  var r = sincronizarFacturasTramo(fechaDesde, hasta);

  // Refresca el cache rapido por cliente para que la ficha del cliente cargue rapido
  generarCacheFacturasCliente(getOrCreateSheet());

  return { total: r.total, nuevas: r.nuevas, errores: r.errores || 0, desde: fechaDesde };
}

// Sincroniza UN tramo de fechas, AGREGANDO sin borrar (evita duplicados por ID).
// Si Siigo da error persistente, divide el rango para aislar la factura problematica.
function sincronizarFacturasTramo(desde, hasta, _prof) {
  _prof = _prof || 0;
  var facturas;
  try {
    facturas = siigoFetchAll('/v1/invoices', {
      created_start: desde,
      created_end: hasta
    }, 300);
  } catch (e) {
    // Si el rango abarca mas de 1 dia y no hemos dividido demasiado, partir en dos mitades
    if (_prof < 9 && desde < hasta) {
      var medio = fechaIntermedia(desde, hasta);
      var sig = siguienteDia(medio);
      var r1 = sincronizarFacturasTramo(desde, medio, _prof + 1);
      // Solo seguir con la 2da mitad si el medio es valido y menor a hasta
      var r2 = (sig <= hasta) ? sincronizarFacturasTramo(sig, hasta, _prof + 1) : { nuevas:0, total:0, errores:0 };
      return {
        nuevas: r1.nuevas + r2.nuevas,
        total: r1.total + r2.total,
        errores: (r1.errores||0) + (r2.errores||0),
      };
    }
    // No se puede dividir mas: saltar este dia/rango problematico
    return { nuevas: 0, total: 0, errores: 1 };
  }
  
  if (facturas.length === 0) return { nuevas: 0, total: 0, errores: 0 };
  
  var ss = getOrCreateSheet();
  var hojaF = ss.getSheetByName('SiigoFacturas');
  var hojaI = ss.getSheetByName('SiigoFacturaItems');
  
  // IDs ya guardados (para no duplicar)
  var existentes = {};
  if (hojaF.getLastRow() > 1) {
    var idsData = hojaF.getRange(2, 1, hojaF.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < idsData.length; i++) existentes[String(idsData[i][0])] = true;
  }
  
  var ahora = new Date();
  var filasFact = [];
  var filasItems = [];
  
  for (var i = 0; i < facturas.length; i++) {
    var f = facturas[i];
    var fid = String(f.id || '');
    if (!fid || existentes[fid]) continue; // saltar duplicados
    existentes[fid] = true;
    
    var tipoDoc = f.document ? String(f.document.name || '') : '';
    var clienteId = f.customer ? String(f.customer.id || '') : '';
    var clienteIdent = f.customer ? String(f.customer.identification || '') : '';
    var vendedorId = extraerVendedorIdSiigo(f);
    var vendedorNombre = extraerVendedorNombreSiigo(f);
    
    // Igual que en cotizaciones (q.public_url): si Siigo entrega un link de vista publica
    // para la factura, lo guardamos para poder mostrar el mismo preview con hipervinculo.
    // Si Siigo no lo manda (no esta documentado para /v1/invoices), queda vacio y el
    // numero de factura simplemente se ve como texto, sin romper nada.
    var publicUrlFactura = String(f.public_url || (f.stamp && f.stamp.public_url) || (f.mail && f.mail.public_url) || '');

    filasFact.push([
      fid,
      String(f.number || f.name || ''),
      f.date || '',
      tipoDoc, clienteId, clienteIdent, vendedorId, vendedorNombre,
      Number(f.subtotal || 0), Number(f.discount || 0),
      Number(f.total_taxes || 0), Number(f.total || 0),
      String(f.annulled ? 'annulled' : (f.status || '')), ahora,
      publicUrlFactura
    ]);
    
    if (f.items && f.items.length > 0) {
      for (var j = 0; j < f.items.length; j++) {
        var it = f.items[j];
        // Nombre: priorizar la descripcion EDITADA dentro de la factura (ej. "manzana verde",
        // "chicle") sobre el nombre generico del catalogo. Mismo criterio que cotizaciones.
        var productoNombre = it.description || it.name || '';
        if (!productoNombre && it.product && typeof it.product === 'object') productoNombre = it.product.name || it.product.description || '';
        var productoCodigo = it.code || '';
        if (!productoCodigo && it.product && typeof it.product === 'object') productoCodigo = it.product.code || '';

        // Precio REAL de la linea (con descuento aplicado, sea en la casilla "descuento"
        // o editando directamente el valor unitario): Siigo entrega en it.total el valor
        // de la linea YA con el descuento restado (antes de IVA). Por eso el total con
        // descuento se calcula PRIMERO, y el precio unitario se DERIVA dividiendo ese
        // total entre la cantidad — asi el unitario tambien refleja el descuento real,
        // en vez de mostrar el precio de catalogo sin descontar.
        var precioUnitBase = Number(it.price || it.unit_price || it.value || 0);
        var cantidadItem = Number(it.quantity || 0);
        var descuentoItem = valorDescuentoSiigo(it.discount);
        var itemTotal = Number(it.total || 0);
        if (!itemTotal && precioUnitBase && cantidadItem) itemTotal = (precioUnitBase * cantidadItem) - descuentoItem;
        var itemTotalIVA = calcularTotalConIvaItemSiigo(it, itemTotal, f.total_taxes);
        var precioUnitIVA = calcularPrecioUnitarioConIvaItemSiigo(itemTotalIVA, cantidadItem, precioUnitBase);

        filasItems.push([
          fid, String(productoNombre || ''), String(productoCodigo || ''),
          cantidadItem, precioUnitIVA,
          descuentoItem, itemTotalIVA
        ]);
      }
    }
  }
  
  // Agregar al final (append)
  if (filasFact.length > 0) {
    var startF = hojaF.getLastRow() + 1;
    for (var i = 0; i < filasFact.length; i += 1000) {
      var chunk = filasFact.slice(i, i + 1000);
      hojaF.getRange(startF + i, 1, chunk.length, 15).setValues(chunk);
    }
  }
  if (filasItems.length > 0) {
    var startI = hojaI.getLastRow() + 1;
    for (var i = 0; i < filasItems.length; i += 1000) {
      var chunk = filasItems.slice(i, i + 1000);
      hojaI.getRange(startI + i, 1, chunk.length, 7).setValues(chunk);
    }
  }

  if (filasFact.length > 0) invalidarResumenCarrera();
  
  return { nuevas: filasFact.length, total: facturas.length, errores: 0 };
}


// ----- COTIZACIONES -----
function sincronizarCotizacionesSiigo(fechaDesde, incremental) {
  // Trae cotizaciones históricas. No son ventas; sirven para seguimiento comercial.
  // Full Company usa Siigo desde 2022, así que el botón trae desde 2022-01-01.
  if (!fechaDesde) fechaDesde = '2022-01-01';
  var manana = new Date();
  manana.setDate(manana.getDate() + 1);
  var hasta = Utilities.formatDate(manana, 'GMT-5', 'yyyy-MM-dd');

  var cotizaciones = siigoFetchAll('/v1/quotations', { created_start: fechaDesde, created_end: hasta }, 800);
  var ss = getOrCreateSheet();
  var hojaC = ss.getSheetByName('SiigoCotizaciones');
  var hojaI = ss.getSheetByName('SiigoCotizacionItems');

  var existentes = {};
  if (incremental && hojaC.getLastRow() > 1) {
    var idsExistentes = hojaC.getRange(2, 1, hojaC.getLastRow() - 1, 1).getValues();
    for (var ex = 0; ex < idsExistentes.length; ex++) existentes[String(idsExistentes[ex][0] || '')] = true;
  } else {
    if (hojaC.getLastRow() > 1) hojaC.getRange(2, 1, hojaC.getLastRow() - 1, hojaC.getLastColumn()).clearContent();
    if (hojaI.getLastRow() > 1) hojaI.getRange(2, 1, hojaI.getLastRow() - 1, hojaI.getLastColumn()).clearContent();
  }

  var ahora = new Date();
  var filasCot = [];
  var filasItems = [];

  for (var i = 0; i < cotizaciones.length; i++) {
    var q = cotizaciones[i];
    var qid = String(q.id || '');
    if (!qid || existentes[qid]) continue;
    existentes[qid] = true;

    var clienteId = q.customer ? String(q.customer.id || '') : '';
    var clienteIdent = q.customer ? normalizarIdentificacion(q.customer.identification || '') : '';
    var fecha = q.date || (q.metadata && q.metadata.created ? String(q.metadata.created).substring(0, 10) : '');
    var vendedorId = extraerVendedorIdSiigo(q);
    var vendedorNombre = extraerVendedorNombreSiigo(q);
    var totalTaxes = Number(q.total_taxes || q.taxes || 0);
    var descuento = valorDescuentoSiigo(q.discount);

    filasCot.push([
      qid,
      String(q.name || q.number || ''),
      fecha,
      clienteId,
      clienteIdent,
      vendedorId,
      vendedorNombre,
      Number(q.subtotal || 0),
      descuento,
      totalTaxes,
      Number(q.total || 0),
      String(q.status || ''),
      String(q.public_url || ''),
      ahora
    ]);

    if (q.items && q.items.length > 0) {
      for (var j = 0; j < q.items.length; j++) {
        var it = q.items[j];
        var productoNombre = it.description || it.name || '';
        if (!productoNombre && it.product && typeof it.product === 'object') productoNombre = it.product.name || it.product.description || '';
        var productoCodigo = it.code || '';
        if (!productoCodigo && it.product && typeof it.product === 'object') productoCodigo = it.product.code || '';
        // Mismo criterio que facturas: el total con descuento manda, el unitario se deriva de el.
        var precioUnitBase = Number(it.price || it.unit_price || it.value || 0);
        var cantidadItem = Number(it.quantity || 0);
        var descuentoItemCot = valorDescuentoSiigo(it.discount);
        var itemTotal = Number(it.total || 0);
        if (!itemTotal && precioUnitBase && cantidadItem) itemTotal = (precioUnitBase * cantidadItem) - descuentoItemCot;
        var itemTotalIVA = calcularTotalConIvaItemSiigo(it, itemTotal, totalTaxes);
        var precioUnitIVA = calcularPrecioUnitarioConIvaItemSiigo(itemTotalIVA, cantidadItem, precioUnitBase);
        filasItems.push([
          qid,
          String(productoNombre || ''),
          String(productoCodigo || ''),
          cantidadItem,
          precioUnitIVA,
          descuentoItemCot,
          itemTotalIVA
        ]);
      }
    }
  }

  if (filasCot.length > 0) {
    var startC = incremental ? hojaC.getLastRow() + 1 : 2;
    for (var a = 0; a < filasCot.length; a += 1000) {
      var chunkC = filasCot.slice(a, a + 1000);
      hojaC.getRange(startC + a, 1, chunkC.length, 14).setValues(chunkC);
    }
  }
  if (filasItems.length > 0) {
    var startI = incremental ? hojaI.getLastRow() + 1 : 2;
    for (var b = 0; b < filasItems.length; b += 1000) {
      var chunkI = filasItems.slice(b, b + 1000);
      hojaI.getRange(startI + b, 1, chunkI.length, 7).setValues(chunkI);
    }
  }

  var cacheCot = generarCacheCotizacionesCliente(ss);
  return { total: cotizaciones.length, nuevas: filasCot.length, items: filasItems.length, desde: fechaDesde, incremental: !!incremental, cacheClientes: cacheCot.clientes, cacheItems: cacheCot.items };
}

// ----- CARTERA -----
function sincronizarCarteraSiigo(fechaDesde) {
  // Cartera pendiente tomada desde facturas con saldo. Por defecto revisa 2 años.
  if (!fechaDesde) fechaDesde = obtenerFechaHaceDias(730);

  var facturas = siigoFetchAll('/v1/invoices', { created_start: fechaDesde }, 300);
  var ss = getOrCreateSheet();
  var hoja = ss.getSheetByName('SiigoCartera');
  if (hoja.getLastRow() > 1) hoja.getRange(2, 1, hoja.getLastRow() - 1, hoja.getLastColumn()).clearContent();

  var nombres = mapaNombresClientesPorIdentificacion(ss);
  var ahora = new Date();
  var filas = [];
  var revisadas = 0;

  for (var i = 0; i < facturas.length; i++) {
    var f = facturas[i];
    revisadas++;
    var tipoDoc = f.document ? String(f.document.name || '') : '';
    var estado = String(f.annulled ? 'annulled' : (f.status || ''));
    if (!esTipoDocumentoVentaValido(tipoDoc) || !esFacturaVentaValida(estado)) continue;

    var saldo = Number(f.balance || 0);
    if (saldo <= 0) continue;

    var ident = f.customer ? normalizarIdentificacion(f.customer.identification || '') : '';
    var venc = fechaVencimientoFacturaSiigo(f);
    var dias = venc ? diasVencidos(venc) : 0;
    var estadoCartera = (venc && dias > 0) ? 'vencida' : 'por_vencer';
    var fid = String(f.id || '');

    filas.push([
      fid + '-' + (venc || ''),
      fid,
      String(f.number || f.name || ''),
      f.date || '',
      venc || '',
      ident,
      nombres[ident] || (f.customer ? String(f.customer.name || '') : ''),
      extraerVendedorIdSiigo(f),
      extraerVendedorNombreSiigo(f),
      Number(f.total || 0),
      saldo,
      dias,
      estadoCartera,
      ahora
    ]);
  }

  if (filas.length > 0) {
    for (var j = 0; j < filas.length; j += 1000) {
      var chunk = filas.slice(j, j + 1000);
      hoja.getRange(j + 2, 1, chunk.length, 14).setValues(chunk);
    }
  }

  var cacheCartera = generarCacheCarteraCliente(ss);
  return { revisadas: revisadas, pendientes: filas.length, desde: fechaDesde, cacheClientes: cacheCartera.clientes };
}


// ----- CACHES RÁPIDOS POR CLIENTE -----
function guardarJSONPorClienteEnChunks(ss, sheetName, mapa, extraMapper) {
  var hoja = ss.getSheetByName(sheetName);
  if (!hoja) return { clientes: 0, chunks: 0 };
  if (hoja.getLastRow() > 1) hoja.getRange(2, 1, hoja.getLastRow() - 1, hoja.getLastColumn()).clearContent();

  var filas = [];
  var ahora = new Date();
  var maxLen = 35000; // por debajo del límite de celda de Google Sheets
  var clientes = 0;
  for (var ident in mapa) {
    if (!ident) continue;
    var payload = mapa[ident] || [];
    var json = JSON.stringify(payload);
    var chunks = json.match(new RegExp('[\\s\\S]{1,' + maxLen + '}', 'g')) || ['[]'];
    var extra = extraMapper ? extraMapper(payload) : [];
    clientes++;
    for (var i = 0; i < chunks.length; i++) {
      filas.push([ident, i, chunks[i]].concat(extra).concat([ahora]));
    }
  }

  if (filas.length > 0) {
    for (var r = 0; r < filas.length; r += 500) {
      var chunkRows = filas.slice(r, r + 500);
      hoja.getRange(r + 2, 1, chunkRows.length, chunkRows[0].length).setValues(chunkRows);
    }
  }
  return { clientes: clientes, chunks: filas.length };
}

function leerJSONPorClienteDesdeCache(ss, sheetName, ident) {
  ident = normalizarIdentificacion(ident);
  var hoja = ss.getSheetByName(sheetName);
  if (!hoja || hoja.getLastRow() <= 1 || !ident) return null;
  var rango = hoja.getRange(2, 1, hoja.getLastRow() - 1, 1);
  var matches = rango.createTextFinder(ident).matchEntireCell(true).findAll();
  if (!matches || matches.length === 0) return null;
  var partes = [];
  for (var i = 0; i < matches.length; i++) {
    var row = matches[i].getRow();
    var vals = hoja.getRange(row, 2, 1, 2).getValues()[0]; // Chunk, JSON
    partes.push({ idx: Number(vals[0] || 0), json: String(vals[1] || '') });
  }
  partes.sort(function(a,b){ return a.idx - b.idx; });
  var json = partes.map(function(x){ return x.json; }).join('');
  try { return JSON.parse(json); } catch(e) { return null; }
}

function generarCacheCotizacionesCliente(ss) {
  ss = ss || getOrCreateSheet();
  var hojaC = ss.getSheetByName('SiigoCotizaciones');
  var hojaI = ss.getSheetByName('SiigoCotizacionItems');
  var mapa = {};
  var cotPorId = {};

  if (hojaC && hojaC.getLastRow() > 1) {
    var data = hojaC.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      var ident = normalizarIdentificacion(data[i][4] || '');
      var id = String(data[i][0] || '');
      if (!ident || !id) continue;
      if (!mapa[ident]) mapa[ident] = [];
      var cot = {
        id: id,
        numero: String(data[i][1] || ''),
        fecha: data[i][2] ? formatearFecha(data[i][2]) : '',
        vendedor: String(data[i][6] || ''),
        subtotal: Number(data[i][7] || 0),
        descuento: Number(data[i][8] || 0),
        impuestos: Number(data[i][9] || 0),
        total: Number(data[i][10] || 0),
        estado: String(data[i][11] || ''),
        publicUrl: String(data[i][12] || ''),
        items: [],
      };
      mapa[ident].push(cot);
      cotPorId[id] = cot;
    }
  }

  if (hojaI && hojaI.getLastRow() > 1) {
    var items = hojaI.getDataRange().getValues();
    for (var j = 1; j < items.length; j++) {
      var qid = String(items[j][0] || '');
      var cot = cotPorId[qid];
      if (!cot) continue;
      cot.items.push({
        producto: String(items[j][1] || ''),
        codigo: String(items[j][2] || ''),
        cantidad: Number(items[j][3] || 0),
        precioUnit: Number(items[j][4] || 0), // v5: con IVA incluido
        descuento: Number(items[j][5] || 0),
        total: Number(items[j][6] || 0), // v5: con IVA incluido cuando la API trae impuestos por línea
      });
    }
  }

  for (var ident in mapa) {
    mapa[ident].sort(function(a,b){ return (b.fecha || '').localeCompare(a.fecha || ''); });
  }

  return guardarJSONPorClienteEnChunks(ss, 'CotizacionesClienteCache', mapa, function(lista){
    var items = 0;
    for (var i = 0; i < lista.length; i++) items += (lista[i].items || []).length;
    return [lista.length, items];
  });
}

function generarCacheCarteraCliente(ss) {
  ss = ss || getOrCreateSheet();
  var hoja = ss.getSheetByName('SiigoCartera');
  var mapa = {};
  if (hoja && hoja.getLastRow() > 1) {
    var data = hoja.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      var ident = normalizarIdentificacion(data[i][5] || '');
      if (!ident) continue;
      if (!mapa[ident]) mapa[ident] = [];
      mapa[ident].push({
        id: String(data[i][0] || ''),
        facturaId: String(data[i][1] || ''),
        numero: String(data[i][2] || ''),
        fechaFactura: data[i][3] ? formatearFecha(data[i][3]) : '',
        fechaVencimiento: data[i][4] ? formatearFecha(data[i][4]) : '',
        clienteIdentificacion: ident,
        clienteNombre: String(data[i][6] || ''),
        vendedorId: String(data[i][7] || ''),
        vendedor: String(data[i][8] || ''),
        valorFactura: Number(data[i][9] || 0),
        saldo: Number(data[i][10] || 0),
        diasVencido: Number(data[i][11] || 0),
        estado: String(data[i][12] || ''),
      });
    }
  }
  for (var ident in mapa) {
    mapa[ident].sort(function(a,b){ return Number(b.diasVencido || 0) - Number(a.diasVencido || 0); });
  }
  return guardarJSONPorClienteEnChunks(ss, 'CarteraClienteCache', mapa, function(lista){
    var saldo = 0;
    for (var i = 0; i < lista.length; i++) saldo += Number(lista[i].saldo || 0);
    return [lista.length, saldo];
  });
}

function obtenerCotizacionesClienteRapido(identificacion) {
  var idLimpia = normalizarIdentificacion(identificacion);
  var ss = getOrCreateSheet();
  var cotizaciones = leerJSONPorClienteDesdeCache(ss, 'CotizacionesClienteCache', idLimpia);
  var desdeCache = true;
  if (cotizaciones === null) {
    desdeCache = false;
    cotizaciones = obtenerCotizacionesClienteDesdeSheetDirecto(ss, idLimpia);
  }
  return { cotizaciones: cotizaciones || [], totalCotizaciones: (cotizaciones || []).length, identificacion: idLimpia, cache: desdeCache };
}

function obtenerCarteraClienteRapido(identificacion) {
  var idLimpia = normalizarIdentificacion(identificacion);
  var ss = getOrCreateSheet();
  var cartera = leerJSONPorClienteDesdeCache(ss, 'CarteraClienteCache', idLimpia);
  var desdeCache = true;
  if (cartera === null) {
    desdeCache = false;
    cartera = obtenerCarteraClienteDesdeSheetDirecto(ss, idLimpia);
  }
  return { cartera: cartera || [], totalCartera: (cartera || []).length, identificacion: idLimpia, cache: desdeCache };
}

// ----- HELPERS SIIGO -----
function obtenerFechaHaceDias(dias) {
  var d = new Date();
  d.setDate(d.getDate() - dias);
  return Utilities.formatDate(d, 'GMT-5', 'yyyy-MM-dd');
}

function normalizarIdentificacion(v) {
  return String(v || '').split('-')[0].trim();
}

function valorDescuentoSiigo(desc) {
  if (desc === null || desc === undefined || desc === '') return 0;
  if (typeof desc === 'number') return Number(desc || 0);
  if (typeof desc === 'object') return Number(desc.value || desc.amount || 0);
  return Number(desc || 0);
}

// Calcula el TOTAL de la linea CON IVA, a partir del total SIN IVA que ya viene
// con el descuento real aplicado (sea que el descuento se haya puesto en la
// casilla "descuento" de Siigo, o que se haya editado directamente el valor
// unitario de la linea: en ambos casos it.total ya refleja el precio real cobrado).
function calcularTotalConIvaItemSiigo(item, itemTotalSinIva, totalImpuestosDocumento) {
  itemTotalSinIva = Number(itemTotalSinIva || 0);
  if (itemTotalSinIva <= 0) return 0;

  // PRIMERO: si la factura/cotización completa no tiene impuestos (total_taxes = 0),
  // devolver it.total directo — sin importar lo que diga el array de taxes por línea.
  // Siigo a veces manda percentage:19 en el array aunque el impuesto real sea $0
  // (facturas exentas, épocas sin IVA). Si f.total_taxes = 0, creemos eso.
  if (totalImpuestosDocumento !== undefined && Number(totalImpuestosDocumento) <= 0) {
    return Math.round(itemTotalSinIva);
  }

  var porcentaje = 0;
  var valorImpuestoLinea = 0;
  var taxes = item.taxes || item.tax || item.impuestos || [];
  if (!Array.isArray(taxes) && taxes) taxes = [taxes];
  for (var i = 0; i < taxes.length; i++) {
    var t = taxes[i] || {};
    porcentaje += Number(t.percentage || t.rate || t.percent || 0);
    valorImpuestoLinea += Number(t.value || t.amount || t.total || 0);
  }

  // Si Siigo trae el MONTO del impuesto por línea (> 0): it.total es el subtotal PRE-IVA
  // de la línea, y taxes[].value/total es el IVA en pesos. Para obtener Vr.Total (con IVA)
  // hay que sumarlos. Esto equivale exactamente a "Vr.Total del PDF / Cantidad".
  if (valorImpuestoLinea > 0) {
    return Math.round(itemTotalSinIva + valorImpuestoLinea);
  }

  // Solo porcentaje sin monto: it.total es base pre-IVA → aplicar la tasa (5%, 19%, etc.)
  if (porcentaje > 0) {
    return Math.round(itemTotalSinIva * (1 + porcentaje / 100));
  }

  // Sin detalle por línea y la factura SÍ tiene IVA: fallback 19% Colombia.
  return Math.round(itemTotalSinIva * 1.19);
}

// Deriva el precio unitario CON IVA y CON el descuento real ya aplicado, dividiendo
// el total correcto (con descuento e IVA) entre la cantidad. Asi el precio unitario
// que se muestra es el que realmente se cobro, sin importar si el descuento se aplico
// en la casilla "descuento" o editando el valor unitario de la linea.
function calcularPrecioUnitarioConIvaItemSiigo(itemTotalConIva, cantidad, precioUnitBaseFallback) {
  cantidad = Number(cantidad || 0);
  itemTotalConIva = Number(itemTotalConIva || 0);

  if (cantidad > 0 && itemTotalConIva > 0) {
    return Math.round(itemTotalConIva / cantidad);
  }

  // Respaldo para casos raros sin cantidad o sin total: al menos mostrar el precio
  // base con el IVA general (no se puede reflejar descuento sin cantidad/total).
  precioUnitBaseFallback = Number(precioUnitBaseFallback || 0);
  return precioUnitBaseFallback > 0 ? Math.round(precioUnitBaseFallback * 1.19) : 0;
}

// ============================================================
// BACKFILL: corrige el PrecioUnit de filas que ya estaban guardadas en
// SiigoFacturaItems/SiigoCotizacionItems ANTES de que sincronizarFacturasSiigo
// empezara a calcular el precio unitario como "Total (con IVA y descuento) /
// Cantidad" (ver calcularPrecioUnitarioConIvaItemSiigo arriba). El cálculo de
// ahora en adelante ya queda bien para lo nuevo que se sincroniza, pero las
// filas viejas se quedaron con el precio de catálogo (sin IVA, sin descuento)
// porque nunca se vuelven a tocar una vez importadas. Esto es pura aritmética
// sobre lo que YA está en la hoja (Total / Cantidad) — no llama a Siigo de nuevo.
//
// Ejecutar UNA VEZ manualmente desde el editor de Apps Script: arriba, en el
// selector de funciones, elegir "corregirPrecioUnitarioHistorico" y darle Run.
// Después revisar "Ejecuciones" o el log para ver cuántas filas se corrigieron.
// No se llama desde la app ni desde ningún botón.
// ============================================================
function corregirPrecioUnitarioHistorico() {
  var ss = getOrCreateSheet();
  var resultado = {};
  ['SiigoFacturaItems', 'SiigoCotizacionItems'].forEach(function(nombreHoja) {
    var hoja = ss.getSheetByName(nombreHoja);
    if (!hoja || hoja.getLastRow() < 2) { resultado[nombreHoja] = 0; return; }
    var filas = hoja.getLastRow() - 1;
    // Columnas (mismo orden en ambas hojas): ...,Cantidad(D),PrecioUnit(E),Descuento(F),Total(G)
    var datos = hoja.getRange(2, 4, filas, 4).getValues();
    var corregidos = 0;
    var nuevaColPrecio = [];
    for (var i = 0; i < datos.length; i++) {
      var cantidad = Number(datos[i][0] || 0);
      var precioActual = Number(datos[i][1] || 0);
      var total = Number(datos[i][3] || 0);
      if (cantidad > 0 && total > 0) {
        var precioCorrecto = Math.round(total / cantidad);
        if (precioCorrecto !== precioActual) corregidos++;
        nuevaColPrecio.push([precioCorrecto]);
      } else {
        nuevaColPrecio.push([precioActual]); // sin datos suficientes: se deja igual
      }
    }
    hoja.getRange(2, 5, nuevaColPrecio.length, 1).setValues(nuevaColPrecio);
    resultado[nombreHoja] = corregidos;
  });
  Logger.log('Backfill precio unitario: ' + JSON.stringify(resultado));
  return resultado;
}

// ============================================================
// DIAGNOSTICO TEMPORAL (solo lectura, no modifica nada): imprime en el log
// los datos crudos guardados en SiigoFacturas + SiigoFacturaItems para las
// facturas indicadas en FACTURAS_A_REVISAR, para entender por que el precio
// unitario sale mal/inconsistente en algunos casos (factura 5834 vs 4748 vs
// 6986). Ejecutar UNA VEZ desde el editor (elegir esta funcion arriba y Run),
// revisar "Ver" > "Registros de ejecucion" o el log, y copiar el resultado.
// ============================================================
function diagnosticoPrecioFacturas() {
  var FACTURAS_A_REVISAR = ['5834', '4748', '6986', '6988'];
  var ss = getOrCreateSheet();

  var hojaF = ss.getSheetByName('SiigoFacturas');
  var datosF = hojaF.getDataRange().getValues(); // [IdSiigo,Numero,Fecha,TipoDoc,ClienteId,ClienteIdentificacion,VendedorId,Vendedor,Subtotal,Descuento,Impuestos,Total,Estado,Actualizado,PublicUrl]
  var facturasEncontradas = [];
  var idsBuscados = {};
  for (var i = 1; i < datosF.length; i++) {
    var numero = String(datosF[i][1] || '');
    if (FACTURAS_A_REVISAR.indexOf(numero) !== -1) {
      var idSiigo = String(datosF[i][0] || '');
      idsBuscados[idSiigo] = numero;
      facturasEncontradas.push({
        idSiigo: idSiigo,
        numero: numero,
        fecha: datosF[i][2],
        subtotal: datosF[i][8],
        descuento: datosF[i][9],
        impuestos: datosF[i][10],
        total: datosF[i][11],
        items: []
      });
    }
  }

  var hojaI = ss.getSheetByName('SiigoFacturaItems');
  var datosI = hojaI.getDataRange().getValues(); // [FacturaId,Producto,Codigo,Cantidad,PrecioUnit,Descuento,Total]
  for (var j = 1; j < datosI.length; j++) {
    var facturaId = String(datosI[j][0] || '');
    if (idsBuscados[facturaId]) {
      var fila = {
        numeroFactura: idsBuscados[facturaId],
        fila: j + 1,
        producto: datosI[j][1],
        codigo: datosI[j][2],
        cantidad: datosI[j][3],
        precioUnit: datosI[j][4],
        descuento: datosI[j][5],
        total: datosI[j][6]
      };
      for (var k = 0; k < facturasEncontradas.length; k++) {
        if (facturasEncontradas[k].idSiigo === facturaId) {
          facturasEncontradas[k].items.push(fila);
          break;
        }
      }
    }
  }

  Logger.log('DIAGNOSTICO PRECIOS:\n' + JSON.stringify(facturasEncontradas, null, 2));
  return facturasEncontradas;
}

function extraerVendedorIdSiigo(obj) {
  if (!obj) return '';
  var s = obj.seller || obj.seller_id || '';
  if (s && typeof s === 'object') return String(s.id || s.identification || '');
  return String(s || '');
}

function extraerVendedorNombreSiigo(obj) {
  if (!obj) return '';
  if (obj.seller_name) return String(obj.seller_name);
  var s = obj.seller || '';
  if (s && typeof s === 'object') return String(s.name || ((s.first_name || '') + ' ' + (s.last_name || '')).trim() || s.username || '');
  return '';
}

function esTipoDocumentoVentaValido(tipoDoc) {
  var t = String(tipoDoc || '').toLowerCase();
  var invalidos = ['cotiz', 'remis', 'pedido', 'proforma', 'orden', 'borrador', 'draft', 'nota cred', 'nota deb', 'devol'];
  for (var i = 0; i < invalidos.length; i++) {
    if (t.indexOf(invalidos[i]) !== -1) return false;
  }
  return true;
}

function fechaVencimientoFacturaSiigo(f) {
  var fechas = [];
  if (f && f.payments && f.payments.length) {
    for (var i = 0; i < f.payments.length; i++) {
      if (f.payments[i] && f.payments[i].due_date) fechas.push(String(f.payments[i].due_date).substring(0, 10));
    }
  }
  fechas.sort();
  return fechas[0] || '';
}

function diasVencidos(fecha) {
  if (!fecha) return 0;
  var hoy = new Date(Utilities.formatDate(new Date(), 'GMT-5', 'yyyy-MM-dd') + 'T00:00:00Z');
  var v = new Date(String(fecha).substring(0, 10) + 'T00:00:00Z');
  var dias = Math.floor((hoy.getTime() - v.getTime()) / (24 * 60 * 60 * 1000));
  return dias > 0 ? dias : 0;
}

function mapaNombresClientesPorIdentificacion(ss) {
  var hoja = ss.getSheetByName('SiigoClientes');
  var mapa = {};
  if (!hoja || hoja.getLastRow() <= 1) return mapa;
  var data = hoja.getRange(2, 2, hoja.getLastRow() - 1, 2).getValues(); // Identificacion, Nombre
  for (var i = 0; i < data.length; i++) {
    var ident = normalizarIdentificacion(data[i][0]);
    if (ident) mapa[ident] = String(data[i][1] || '');
  }
  return mapa;
}


// Devuelve la fecha intermedia entre dos fechas 'YYYY-MM-DD'
function fechaIntermedia(desde, hasta) {
  var d1 = new Date(desde + 'T00:00:00Z').getTime();
  var d2 = new Date(hasta + 'T00:00:00Z').getTime();
  var medio = new Date((d1 + d2) / 2);
  return Utilities.formatDate(medio, 'GMT', 'yyyy-MM-dd');
}

// Devuelve el dia siguiente a una fecha 'YYYY-MM-DD'
function siguienteDia(fecha) {
  var d = new Date(fecha + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return Utilities.formatDate(d, 'GMT', 'yyyy-MM-dd');
}

// Sincroniza el historial yendo hacia atras MES a MES.
// Se detiene al acercarse al limite de tiempo (para no exceder 6 min).
// Guarda progreso: se puede llamar varias veces hasta completar.
function sincronizarHistorialCompleto() {
  var props = PropertiesService.getScriptProperties();
  var inicio = new Date();
  var limiteMs = 4.5 * 60 * 1000; // 4.5 min (margen antes del limite de 6)
  
  // Continuar desde donde quedo, o empezar desde hoy
  var progreso = props.getProperty('siigo_historial_cursor');
  var cursor = progreso ? new Date(progreso) : new Date();
  
  // Cuantos meses vacios seguidos llevamos (para detectar el inicio del historial)
  var vaciosSeguidos = parseInt(props.getProperty('siigo_historial_vacios') || '0');
  
  var totalNuevas = 0;
  var tramosHechos = 0;
  var totalErrores = 0;
  var completado = false;
  
  // Limite duro: no ir mas atras de 2018
  var limiteAntiguo = new Date('2018-01-01');
  
  while ((new Date() - inicio) < limiteMs) {
    // Tramo de un mes
    var fin = new Date(cursor);
    var ini = new Date(cursor);
    ini.setMonth(ini.getMonth() - 1);
    
    if (fin <= limiteAntiguo) { completado = true; break; }
    
    var desde = ini.toISOString().split('T')[0];
    var hasta = fin.toISOString().split('T')[0];
    
    var r = sincronizarFacturasTramo(desde, hasta);
    totalNuevas += r.nuevas;
    totalErrores += (r.errores || 0);
    tramosHechos++;
    
    // Avanzar cursor hacia atras
    cursor = ini;
    props.setProperty('siigo_historial_cursor', cursor.toISOString());
    
    // Detectar fin del historial: 4 meses seguidos REALMENTE vacios (sin error)
    if (r.total === 0 && (r.errores || 0) === 0) {
      vaciosSeguidos++;
    } else {
      vaciosSeguidos = 0;
    }
    props.setProperty('siigo_historial_vacios', String(vaciosSeguidos));
    
    if (vaciosSeguidos >= 4) { completado = true; break; }
  }
  
  if (completado) {
    props.setProperty('siigo_historial_completo', 'true');
    props.deleteProperty('siigo_historial_cursor');
    props.deleteProperty('siigo_historial_vacios');
  }
  
  var ss = getOrCreateSheet();
  var totalFacturas = Math.max(0, ss.getSheetByName('SiigoFacturas').getLastRow() - 1);

  // Refresca el cache rapido por cliente (este camino del historial no pasa por
  // sincronizarFacturasSiigo, asi que hay que refrescar el cache aqui tambien)
  generarCacheFacturasCliente(ss);
  
  return {
    completado: completado,
    tramosHechos: tramosHechos,
    nuevasEstaVez: totalNuevas,
    tramosConError: totalErrores,
    totalFacturasAcumuladas: totalFacturas,
    cursorActual: completado ? 'COMPLETO' : cursor.toISOString().split('T')[0],
    mensaje: completado 
      ? '✅ Historial completo sincronizado: ' + totalFacturas + ' facturas en total'
      : '⏳ Voy en ' + cursor.toISOString().split('T')[0] + '. Dale otra vez para continuar.',
  };
}

// Reiniciar el historial (borra todo y empieza de cero)
function reiniciarHistorialSiigo() {
  var props = PropertiesService.getScriptProperties();
  props.deleteProperty('siigo_historial_cursor');
  props.deleteProperty('siigo_historial_vacios');
  props.deleteProperty('siigo_historial_completo');
  
  var ss = getOrCreateSheet();
  var hojaF = ss.getSheetByName('SiigoFacturas');
  var hojaI = ss.getSheetByName('SiigoFacturaItems');
  if (hojaF.getLastRow() > 1) hojaF.getRange(2, 1, hojaF.getLastRow() - 1, hojaF.getLastColumn()).clearContent();
  if (hojaI.getLastRow() > 1) hojaI.getRange(2, 1, hojaI.getLastRow() - 1, hojaI.getLastColumn()).clearContent();
  var hojaCacheF = ss.getSheetByName('FacturasClienteCache');
  if (hojaCacheF && hojaCacheF.getLastRow() > 1) hojaCacheF.getRange(2, 1, hojaCacheF.getLastRow() - 1, hojaCacheF.getLastColumn()).clearContent();
  
  return { status: 'ok', mensaje: 'Historial reiniciado. Ejecuta sincronizarHistorialCompleto para empezar.' };
}

// ============================================================
// TRIGGER AUTOMATICO
// ============================================================

function instalarTriggerSiigo() {
  // Eliminar triggers existentes
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'sincronizarTodo') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  
  ScriptApp.newTrigger('sincronizarTodo')
    .timeBased()
    .everyHours(1)
    .create();
  
  return { status: 'ok', mensaje: 'Trigger instalado: sincronizara cada 1 hora' };
}

function desinstalarTriggerSiigo() {
  var count = 0;
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'sincronizarTodo') {
      ScriptApp.deleteTrigger(triggers[i]);
      count++;
    }
  }
  return { status: 'ok', mensaje: 'Triggers eliminados: ' + count };
}

// ============================================================
// ESTADO
// ============================================================

function obtenerEstadoSiigo() {
  var props = PropertiesService.getScriptProperties();
  
  var configurado = !!(props.getProperty('siigo_username') && props.getProperty('siigo_access_key'));
  var ultimaSync = props.getProperty('siigo_ultima_sync') || null;
  var ultimoResultado = null;
  try { ultimoResultado = JSON.parse(props.getProperty('siigo_ultimo_resultado') || 'null'); } catch (e) {}
  
  // Contar registros
  var ss = getOrCreateSheet();
  var contadores = {};
  ['SiigoClientes', 'SiigoFacturas', 'SiigoFacturaItems', 'SiigoProductos', 'SiigoCotizaciones', 'SiigoCotizacionItems', 'SiigoCartera'].forEach(function(n){
    var h = ss.getSheetByName(n);
    contadores[n] = h ? Math.max(0, h.getLastRow() - 1) : 0;
  });
  
  // Trigger activo?
  var triggerActivo = false;
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'sincronizarTodo') triggerActivo = true;
  }
  
  return {
    configurado: configurado,
    ultimaSync: ultimaSync,
    ultimoResultado: ultimoResultado,
    contadores: contadores,
    triggerActivo: triggerActivo,
    partnerId: SIIGO_PARTNER_ID,
  };
}

function probarConexionSiigo() {
  try {
    var token = siigoAuth(true);
    // Hacer una llamada simple para verificar
    var data = siigoApi('/v1/users', { page: 1, page_size: 1 });
    return {
      status: 'ok',
      mensaje: 'Conexion exitosa con Siigo',
      partnerId: SIIGO_PARTNER_ID,
      muestra: data.results ? data.results.length + ' vendedores accesibles' : 'sin datos',
    };
  } catch (e) {
    return {
      status: 'error',
      mensaje: e.message,
    };
  }
}

// ============================================================
// HISTORIAL DE FACTURAS POR CLIENTE (para la ficha)
// ============================================================
// ============================================================
// PROCESAMIENTO DE CLIENTES (Parte 2 - genera datos para la app)
// ============================================================

// Calcula el estado (semaforo) segun dias desde ultima compra y frecuencia individual
function calcularEstadoCliente(diasDesde, frecuencia, numCompras) {
  if (numCompras === 0) return 'sin_compras';
  // Frecuencia propia del cliente; si solo tiene 1 compra, asumimos 45 días
  var freq = (frecuencia > 0) ? frecuencia : 45;
  // Umbrales relativos al ciclo individual de cada cliente:
  //  activo   = dentro del ciclo normal         (≤ 1×)
  //  toca     = ciclo cumplido, hora de llamar  (1× – 1.5×)
  //  atrasado = pasó su ventana habitual         (1.5× – 2.5×)
  //  riesgo   = muy atrasado                    (2.5× – 4×)
  //  perdido  = más de 4 ciclos sin comprar
  if (diasDesde <= freq)        return 'activo';
  if (diasDesde <= freq * 1.5)  return 'toca';
  if (diasDesde <= freq * 2.5)  return 'atrasado';
  if (diasDesde <= freq * 4)    return 'riesgo';
  return 'perdido';
}

// Evita que facturas anuladas/canceladas entren al dashboard, clientes y carrera.
function esFacturaVentaValida(estado) {
  var e = String(estado || '').toLowerCase();
  if (!e) return true;
  var invalidos = ['anul', 'annul', 'cancel', 'void', 'draft', 'borrador', 'rechaz', 'reject', 'elimin', 'delete'];
  for (var i = 0; i < invalidos.length; i++) {
    if (e.indexOf(invalidos[i]) !== -1) return false;
  }
  return true;
}

// Siigo a veces deja alguna columna en cero según el endpoint; priorizamos Total y, si falta, reconstruimos.
function valorFacturaVenta(row) {
  var total = Number(row[11] || 0);
  if (total !== 0) return total;
  return Number(row[8] || 0) - Number(row[9] || 0) + Number(row[10] || 0);
}

function esProductoIgnorable(nombre) {
  var n = String(nombre || '').trim().toLowerCase();
  if (!n) return true;
  return n === 'producto' || n === 'producto generico' || n === 'producto genérico';
}

// Detecta productos recurrentes que el cliente compraba y luego dejó de comprar, pero siguió comprando otras cosas.
function detectarCambioPatronProductos(productosAcum, fechas, frecuencia) {
  // Detecta productos que el cliente compraba antes y dejó de comprar,
  // pero siguió comprando otros productos. Es práctico para vendedores.
  if (!fechas || fechas.length < 2) return null;
  var primeraMs = fechas[0].getTime();
  var ultimaMs = fechas[fechas.length - 1].getTime();
  var diaMs = 86400000;
  var limiteOlvidoDias = Math.max(45, Math.min(120, Math.round((frecuencia || 30) * 1.3)));
  var limiteNuevoDias = 90;
  var olvidados = [];
  var nuevos = [];

  for (var nom in productosAcum) {
    if (esProductoIgnorable(nom)) continue;
    var pa = productosAcum[nom];
    var mesesDistintos = pa.meses ? Object.keys(pa.meses).length : 0;
    var recurrente = (pa.vecesComprado >= 2 || mesesDistintos >= 2 || pa.valor >= 50000);
    var diasSinProducto = pa._ultMs ? Math.round((ultimaMs - pa._ultMs) / diaMs) : 0;
    var huboComprasDespues = pa._ultMs && (ultimaMs - pa._ultMs) >= (14 * diaMs);

    if (recurrente && huboComprasDespues && diasSinProducto >= limiteOlvidoDias) {
      olvidados.push({ nombre: pa.nombre, valor: pa.valor || 0, dias: diasSinProducto, veces: pa.vecesComprado || 0 });
    }

    var productoNuevo = pa._primMs && (pa._primMs - primeraMs) >= 30 * diaMs && (ultimaMs - pa._primMs) <= limiteNuevoDias * diaMs;
    if (productoNuevo) {
      nuevos.push({ nombre: pa.nombre, valor: pa.valor || 0 });
    }
  }

  olvidados.sort(function(a,b){ return (b.valor - a.valor) || (b.dias - a.dias) || (b.veces - a.veces); });
  nuevos.sort(function(a,b){ return b.valor - a.valor; });

  var r = {
    dejoComprar: olvidados.slice(0, 7).map(function(x){ return x.nombre; }),
    nuevosProductos: nuevos.slice(0, 5).map(function(x){ return x.nombre; })
  };
  if (r.dejoComprar.length === 0 && r.nuevosProductos.length === 0) return null;
  return r;
}

function procesarClientesSiigo() {
  var ss = getOrCreateSheet();
  var hojaC = ss.getSheetByName('SiigoClientes');
  var hojaF = ss.getSheetByName('SiigoFacturas');
  var hojaI = ss.getSheetByName('SiigoFacturaItems');
  
  if (!hojaC || hojaC.getLastRow() < 2) return { error: 'No hay clientes sincronizados' };
  
  var clientesData = hojaC.getDataRange().getValues();
  var facturasData = hojaF && hojaF.getLastRow() > 1 ? hojaF.getDataRange().getValues() : [];
  var itemsData = hojaI && hojaI.getLastRow() > 1 ? hojaI.getDataRange().getValues() : [];
  
  // Indexar items por FacturaId
  var itemsPorFactura = {};
  for (var i = 1; i < itemsData.length; i++) {
    var fid = String(itemsData[i][0]);
    if (!itemsPorFactura[fid]) itemsPorFactura[fid] = [];
    itemsPorFactura[fid].push({
      producto: String(itemsData[i][1] || ''),
      cantidad: Number(itemsData[i][3] || 0),
      precioUnit: Number(itemsData[i][4] || 0),
      valor: Number(itemsData[i][6] || 0),
    });
  }
  
  // Agrupar facturas por identificacion de cliente
  // OJO: aquí filtramos documentos que no sean ventas y evitamos duplicados por ID.
  var facturasPorCliente = {};
  var facturasProcesadas = {};
  for (var i = 1; i < facturasData.length; i++) {
    var fidProcesar = String(facturasData[i][0] || '');
    if (!fidProcesar || facturasProcesadas[fidProcesar]) continue;
    facturasProcesadas[fidProcesar] = true;

    var tipoDocFactura = String(facturasData[i][3] || '');
    var estadoFactura = String(facturasData[i][12] || '');
    if (!esTipoDocumentoVentaValido(tipoDocFactura) || !esFacturaVentaValida(estadoFactura)) continue;

    var ident = normalizarIdentificacion(facturasData[i][5] || '');
    if (!ident) continue;
    if (!facturasPorCliente[ident]) facturasPorCliente[ident] = [];
    facturasPorCliente[ident].push({
      id: fidProcesar,
      fecha: facturasData[i][2],
      total: valorFacturaVenta(facturasData[i]),
      vendedor: String(facturasData[i][7] || ''),
      estado: estadoFactura,
      tipoDoc: tipoDocFactura,
    });
  }
  
  var hoy = new Date();
  var clientes = [];
  var ventasMensualesGlobal = {}; // mes -> valor (para el dashboard)
  
  for (var ci = 1; ci < clientesData.length; ci++) {
    var c = clientesData[ci];
    var ident = String(c[1] || '').split('-')[0].trim();
    if (!ident) continue;
    
    var facturas = facturasPorCliente[ident] || [];
    
    var fechas = [];
    var total = 0;
    var vendedores = {};
    var ultimoVendedor = '';   // vendedor de la factura MAS reciente
    var _ultVendMs = 0;
    var productosAcum = {};   // nombre -> {cantidad, valor, ultimaFecha}
    var comprasPorMesObj = {}; // mes -> valor
    
    for (var k = 0; k < facturas.length; k++) {
      var f = facturas[k];
      total += f.total;
      var fch = null;
      if (f.fecha) {
        fch = (f.fecha instanceof Date) ? f.fecha : new Date(f.fecha);
        if (isNaN(fch.getTime())) fch = null;
      }
      if (fch) {
        fechas.push(fch);
        var mes = Utilities.formatDate(fch, 'GMT-5', 'yyyy-MM');
        comprasPorMesObj[mes] = (comprasPorMesObj[mes] || 0) + f.total;
        ventasMensualesGlobal[mes] = (ventasMensualesGlobal[mes] || 0) + f.total;
      }
      if (f.vendedor) vendedores[f.vendedor] = (vendedores[f.vendedor] || 0) + 1;
      // Vendedor de la factura mas reciente
      if (fch && f.vendedor) {
        var vms = fch.getTime();
        if (vms >= _ultVendMs) { _ultVendMs = vms; ultimoVendedor = f.vendedor; }
      }
      
      // Productos de esta factura
      var its = itemsPorFactura[f.id] || [];
      for (var p = 0; p < its.length; p++) {
        var nom = its[p].producto || 'Producto';
        if (!productosAcum[nom]) productosAcum[nom] = { nombre: nom, cantidad: 0, valor: 0, ultimaFecha: '', ultimaCantidad: 0, ultimoPrecioUnit: 0, _ultMs: 0, _primMs: 0, vecesComprado: 0, meses: {} };
        productosAcum[nom].cantidad += its[p].cantidad;
        productosAcum[nom].valor += its[p].valor;
        productosAcum[nom].vecesComprado += 1;
        if (fch) {
          var fStr = Utilities.formatDate(fch, 'GMT-5', 'yyyy-MM');
          var ms = fch.getTime();
          productosAcum[nom].meses[fStr] = true;
          if (!productosAcum[nom]._primMs || ms < productosAcum[nom]._primMs) productosAcum[nom]._primMs = ms;
          // Guardar cantidad y precio de la compra MAS RECIENTE de este producto
          if (ms >= productosAcum[nom]._ultMs) {
            productosAcum[nom]._ultMs = ms;
            productosAcum[nom].ultimaFecha = fStr;
            productosAcum[nom].ultimaCantidad = its[p].cantidad;
            productosAcum[nom].ultimoPrecioUnit = its[p].precioUnit;
          }
        }
      }
    }
    fechas.sort(function(a, b){ return a - b; });
    
    var numCompras = facturas.length;
    var primeraCompra = fechas.length > 0 ? Utilities.formatDate(fechas[0], 'GMT-5', 'yyyy-MM') : '';
    var ultimaCompra = fechas.length > 0 ? Utilities.formatDate(fechas[fechas.length-1], 'GMT-5', 'yyyy-MM') : '';
    
    var frecuencia = null;
    if (fechas.length >= 2) {
      var difTotal = 0;
      for (var k = 1; k < fechas.length; k++) difTotal += (fechas[k] - fechas[k-1]) / 86400000;
      frecuencia = Math.round(difTotal / (fechas.length - 1));
    }
    
    var diasDesde = fechas.length > 0 ? Math.floor((hoy - fechas[fechas.length-1]) / 86400000) : 9999;
    var mesesSinComprar = fechas.length > 0 ? Math.floor(diasDesde / 30) : 999;
    var estado = calcularEstadoCliente(diasDesde, frecuencia || 0, numCompras);
    
    // mesesActivos = meses distintos con compra
    var mesesActivos = Object.keys(comprasPorMesObj).length;
    var ticketMes = mesesActivos > 0 ? Math.round(total / mesesActivos) : 0;
    
    // Vendedor principal
    var vendedorPrincipal = '';
    var maxV = 0;
    for (var v in vendedores) { if (vendedores[v] > maxV) { maxV = vendedores[v]; vendedorPrincipal = v; } }
    
    // Productos: topProductos usa {nombre,cantidad,valor}; todosProductos (chuleta) usa {nombre,ultimoMes,ultimaCantidad,ultimoPrecioUnit,valorTotal}
    var listaProd = [];
    for (var nom in productosAcum) {
      var pa = productosAcum[nom];
      listaProd.push({
        nombre: pa.nombre,
        cantidad: Math.round(pa.cantidad * 100) / 100,
        cantTotal: Math.round(pa.cantidad * 100) / 100,
        valor: Math.round(pa.valor),
        valorTotal: Math.round(pa.valor),
        vecesComprado: pa.vecesComprado || 0,
        ultimoMes: pa.ultimaFecha,
        ultimaCantidad: Math.round(pa.ultimaCantidad * 100) / 100,
        ultimoPrecioUnit: Math.round(pa.ultimoPrecioUnit),
      });
    }
    var topProductos = listaProd.slice().sort(function(a,b){ return b.valor - a.valor; }).slice(0, 10);
    var todosProductos = listaProd.sort(function(a,b){ return (b.ultimoMes||'').localeCompare(a.ultimoMes||''); });
    var cambioPatron = detectarCambioPatronProductos(productosAcum, fechas, frecuencia);
    
    // comprasPorMes como array ordenado
    var comprasPorMes = [];
    var mesesOrden = Object.keys(comprasPorMesObj).sort();
    for (var m = 0; m < mesesOrden.length; m++) {
      comprasPorMes.push({ mes: mesesOrden[m], valor: Math.round(comprasPorMesObj[mesesOrden[m]]) });
    }
    
    var tipoPersona = String(c[3] || '');
    var esEmpresa = (tipoPersona === 'Company' || tipoPersona === 'Empresa');
    var tipo = esEmpresa ? 'empresa' : 'hogar';
    var tel = String(c[7] || '').trim();
    
    clientes.push({
      id: ident,
      nombre: String(c[2] || ''),
      tipo: tipo,
      esEmpresa: esEmpresa,
      tipoId: esEmpresa ? 'NIT' : 'CC',
      telefonos: tel ? [tel] : [],
      telefonosFormat: tel ? [tel] : [],
      correo: String(c[8] || ''),
      direccion: String(c[6] || ''),
      ciudad: String(c[5] || ''),
      contacto: String(c[2] || ''),
      vendedor: vendedorPrincipal,
      ultimoVendedor: ultimoVendedor,
      total: Math.round(total),
      mesesActivos: mesesActivos,
      frecuenciaDias: frecuencia,
      ticketMes: ticketMes,
      primeraCompra: primeraCompra,
      ultimaCompra: ultimaCompra,
      mesesSinComprar: mesesSinComprar,
      numCompras: numCompras,
      estado: estado,
      topProductos: topProductos,
      todosProductos: todosProductos,
      topGrupos: total > 0 ? [{ grupo: 'Productos', valor: Math.round(total) }] : [],
      comprasPorMes: comprasPorMes,
      cambioPatron: cambioPatron,
    });
  }
  
  // ----- GLOBAL para el dashboard -----
  var ventasMensuales = [];
  var mesesG = Object.keys(ventasMensualesGlobal).sort();
  for (var m = 0; m < mesesG.length; m++) {
    ventasMensuales.push([mesesG[m], Math.round(ventasMensualesGlobal[mesesG[m]])]);
  }
  var topClientes = clientes.slice().sort(function(a,b){ return b.total - a.total; }).slice(0, 10)
    .map(function(c){ return { id: c.id, nombre: c.nombre, total: c.total, estado: c.estado }; });
  var perdidosValiosos = clientes.filter(function(c){ return c.estado === 'perdido' && c.total > 0; })
    .sort(function(a,b){ return b.total - a.total; }).slice(0, 12)
    .map(function(c){ return { id: c.id, nombre: c.nombre, total: c.total, mesesSinComprar: c.mesesSinComprar }; });
  
  var global = {
    ventasMensuales: ventasMensuales,
    topClientes: topClientes,
    perdidosValiosos: perdidosValiosos,
  };
  
  // Guardar en cache (chunks)
  var payload = JSON.stringify({ clientes: clientes, global: global });
  var hojaCache = ss.getSheetByName('DatosCache');
  if (!hojaCache) hojaCache = ss.insertSheet('DatosCache');
  if (hojaCache.getLastRow() > 0) hojaCache.clearContents();
  
  var chunkSize = 45000;
  var filas = [];
  for (var i = 0; i < payload.length; i += chunkSize) filas.push([payload.substring(i, i + chunkSize)]);
  if (filas.length > 0) hojaCache.getRange(1, 1, filas.length, 1).setValues(filas);
  
  var props = PropertiesService.getScriptProperties();
  props.setProperty('clientes_cache_fecha', hoy.toISOString());
  props.setProperty('clientes_cache_count', String(clientes.length));
  
  var conCompras = 0, activos = 0, perdidos = 0;
  for (var i = 0; i < clientes.length; i++) {
    if (clientes[i].numCompras > 0) conCompras++;
    if (clientes[i].estado === 'activo') activos++;
    if (clientes[i].estado === 'perdido') perdidos++;
  }
  
  return {
    clientesProcesados: clientes.length,
    conCompras: conCompras,
    activos: activos,
    perdidos: perdidos,
    tamanoKB: Math.round(payload.length / 1024),
    chunks: filas.length,
  };
}

// Sirve los clientes procesados a la app (lee del cache)
function cargarClientesProcesados() {
  var ss = getOrCreateSheet();
  var hoja = ss.getSheetByName('DatosCache');
  if (!hoja || hoja.getLastRow() === 0) return { sinCache: true };
  
  var filas = hoja.getRange(1, 1, hoja.getLastRow(), 1).getValues();
  var json = '';
  for (var i = 0; i < filas.length; i++) json += filas[i][0];
  
  var props = PropertiesService.getScriptProperties();
  var payload = null;
  try { payload = JSON.parse(json); } catch (e) { return { error: 'cache corrupto' }; }
  
  return {
    clientes: payload.clientes || [],
    global: payload.global || {},
    fecha: props.getProperty('clientes_cache_fecha'),
    count: (payload.clientes || []).length,
  };
}


function obtenerFacturasCliente(identificacion) {
  if (!identificacion) return { facturas: [], cotizaciones: [], cartera: [], error: 'Falta identificacion' };

  // La identificacion puede venir como "900123456-7" (con DV). Quitamos el DV.
  var idLimpia = normalizarIdentificacion(identificacion);

  var ss = getOrCreateSheet();

  // Igual que cotizaciones/cartera: primero intenta el cache rápido por cliente
  // (mucho más rápido que recorrer TODA la hoja de facturas en cada clic), y si no
  // hay cache todavía (recién instalado, o aún no corrió la sincronización) cae al
  // escaneo directo de las hojas de Siigo.
  var facturasCliente = leerJSONPorClienteDesdeCache(ss, 'FacturasClienteCache', idLimpia);
  if (facturasCliente === null) facturasCliente = obtenerFacturasClienteDesdeSheetDirecto(ss, idLimpia);

  var cotizaciones = leerJSONPorClienteDesdeCache(ss, 'CotizacionesClienteCache', idLimpia);
  if (cotizaciones === null) cotizaciones = obtenerCotizacionesClienteDesdeSheetDirecto(ss, idLimpia);
  var cartera = leerJSONPorClienteDesdeCache(ss, 'CarteraClienteCache', idLimpia);
  if (cartera === null) cartera = obtenerCarteraClienteDesdeSheetDirecto(ss, idLimpia);

  return {
    facturas: facturasCliente,
    cotizaciones: cotizaciones,
    cartera: cartera,
    total: facturasCliente.length,
    totalCotizaciones: cotizaciones.length,
    totalCartera: cartera.length,
    identificacion: idLimpia,
  };
}

// Escaneo directo (lento, recorre toda la hoja): solo se usa de respaldo si el cache
// todavía no se ha generado para este cliente.
function obtenerFacturasClienteDesdeSheetDirecto(ss, idLimpia) {
  var hojaF = ss.getSheetByName('SiigoFacturas');
  var hojaI = ss.getSheetByName('SiigoFacturaItems');

  var facturasCliente = [];
  var idsFacturas = {};

  if (hojaF) {
    var facturasData = hojaF.getDataRange().getValues();

    // Filtrar facturas del cliente (columna 6 = ClienteIdentificacion, indice 5)
    for (var i = 1; i < facturasData.length; i++) {
      var clienteIdent = normalizarIdentificacion(facturasData[i][5] || '');
      if (clienteIdent !== idLimpia) continue;

      var fid = String(facturasData[i][0] || '');
      if (!fid || idsFacturas[fid]) continue; // evita duplicados
      var tipoDoc = String(facturasData[i][3] || '');
      var estado = String(facturasData[i][12] || '');
      if (!esTipoDocumentoVentaValido(tipoDoc) || !esFacturaVentaValida(estado)) continue;

      idsFacturas[fid] = true;
      facturasCliente.push({
        id: fid,
        numero: String(facturasData[i][1] || ''),
        fecha: facturasData[i][2] ? formatearFecha(facturasData[i][2]) : '',
        tipoDoc: tipoDoc,
        vendedor: String(facturasData[i][7] || ''),
        subtotal: Number(facturasData[i][8] || 0),
        descuento: Number(facturasData[i][9] || 0),
        impuestos: Number(facturasData[i][10] || 0),
        total: Number(facturasData[i][11] || 0),
        estado: estado,
        publicUrl: String(facturasData[i][14] || ''),
        items: [],
      });
    }
  }

  // Agregar items (solo de las facturas de este cliente)
  if (hojaI) {
    var itemsData = hojaI.getDataRange().getValues();
    var facturaPorId = {};
    for (var k = 0; k < facturasCliente.length; k++) {
      facturaPorId[facturasCliente[k].id] = facturasCliente[k];
    }
    for (var j = 1; j < itemsData.length; j++) {
      var fidItem = String(itemsData[j][0]);
      if (idsFacturas[fidItem] && facturaPorId[fidItem]) {
        facturaPorId[fidItem].items.push({
          producto: String(itemsData[j][1] || ''),
          codigo: String(itemsData[j][2] || ''),
          cantidad: Number(itemsData[j][3] || 0),
          precioUnit: Number(itemsData[j][4] || 0),
          descuento: Number(itemsData[j][5] || 0),
          total: Number(itemsData[j][6] || 0),
        });
      }
    }
  }

  // Ordenar por fecha descendente (mas reciente primero)
  facturasCliente.sort(function(a, b){ return (b.fecha || '').localeCompare(a.fecha || ''); });
  return facturasCliente;
}

// Construye el cache rápido por cliente (uno por cada identificación) recorriendo
// las hojas de Siigo UNA sola vez, en vez de recorrerlas cada vez que alguien abre
// la ficha de un cliente. Se llama al terminar cada sincronización de facturas.
function generarCacheFacturasCliente(ss) {
  ss = ss || getOrCreateSheet();
  var hojaF = ss.getSheetByName('SiigoFacturas');
  var hojaI = ss.getSheetByName('SiigoFacturaItems');
  var mapa = {};
  var facturaPorId = {};

  if (hojaF && hojaF.getLastRow() > 1) {
    var facturasData = hojaF.getDataRange().getValues();
    for (var i = 1; i < facturasData.length; i++) {
      var ident = normalizarIdentificacion(facturasData[i][5] || '');
      var fid = String(facturasData[i][0] || '');
      if (!ident || !fid || facturaPorId[fid]) continue; // evita duplicados

      var tipoDoc = String(facturasData[i][3] || '');
      var estado = String(facturasData[i][12] || '');
      if (!esTipoDocumentoVentaValido(tipoDoc) || !esFacturaVentaValida(estado)) continue;

      var fact = {
        id: fid,
        numero: String(facturasData[i][1] || ''),
        fecha: facturasData[i][2] ? formatearFecha(facturasData[i][2]) : '',
        tipoDoc: tipoDoc,
        vendedor: String(facturasData[i][7] || ''),
        subtotal: Number(facturasData[i][8] || 0),
        descuento: Number(facturasData[i][9] || 0),
        impuestos: Number(facturasData[i][10] || 0),
        total: Number(facturasData[i][11] || 0),
        estado: estado,
        publicUrl: String(facturasData[i][14] || ''),
        items: [],
      };
      if (!mapa[ident]) mapa[ident] = [];
      mapa[ident].push(fact);
      facturaPorId[fid] = fact;
    }
  }

  if (hojaI && hojaI.getLastRow() > 1) {
    var itemsData = hojaI.getDataRange().getValues();
    for (var j = 1; j < itemsData.length; j++) {
      var fidItem = String(itemsData[j][0] || '');
      var fact = facturaPorId[fidItem];
      if (!fact) continue;
      fact.items.push({
        producto: String(itemsData[j][1] || ''),
        codigo: String(itemsData[j][2] || ''),
        cantidad: Number(itemsData[j][3] || 0),
        precioUnit: Number(itemsData[j][4] || 0),
        descuento: Number(itemsData[j][5] || 0),
        total: Number(itemsData[j][6] || 0),
      });
    }
  }

  for (var ident in mapa) {
    mapa[ident].sort(function(a,b){ return (b.fecha || '').localeCompare(a.fecha || ''); });
  }

  return guardarJSONPorClienteEnChunks(ss, 'FacturasClienteCache', mapa, function(lista){
    var total = 0;
    for (var i = 0; i < lista.length; i++) total += Number(lista[i].total || 0);
    return [lista.length, total];
  });
}

function obtenerCotizacionesClienteDesdeSheetDirecto(ss, idLimpia) {
  var hojaC = ss.getSheetByName('SiigoCotizaciones');
  var hojaI = ss.getSheetByName('SiigoCotizacionItems');
  var cotizaciones = [];
  var ids = {};

  if (!hojaC || hojaC.getLastRow() <= 1) return cotizaciones;
  var data = hojaC.getDataRange().getValues();

  for (var i = 1; i < data.length; i++) {
    var ident = normalizarIdentificacion(data[i][4] || '');
    if (ident !== idLimpia) continue;
    var id = String(data[i][0] || '');
    if (!id || ids[id]) continue;
    ids[id] = true;
    cotizaciones.push({
      id: id,
      numero: String(data[i][1] || ''),
      fecha: data[i][2] ? formatearFecha(data[i][2]) : '',
      vendedor: String(data[i][6] || ''),
      subtotal: Number(data[i][7] || 0),
      descuento: Number(data[i][8] || 0),
      impuestos: Number(data[i][9] || 0),
      total: Number(data[i][10] || 0),
      estado: String(data[i][11] || ''),
      publicUrl: String(data[i][12] || ''),
      items: [],
    });
  }

  if (hojaI && hojaI.getLastRow() > 1) {
    var items = hojaI.getDataRange().getValues();
    var cotPorId = {};
    for (var k = 0; k < cotizaciones.length; k++) cotPorId[cotizaciones[k].id] = cotizaciones[k];
    for (var j = 1; j < items.length; j++) {
      var qid = String(items[j][0] || '');
      if (ids[qid] && cotPorId[qid]) {
        cotPorId[qid].items.push({
          producto: String(items[j][1] || ''),
          codigo: String(items[j][2] || ''),
          cantidad: Number(items[j][3] || 0),
          precioUnit: Number(items[j][4] || 0),
          descuento: Number(items[j][5] || 0),
          total: Number(items[j][6] || 0),
        });
      }
    }
  }

  cotizaciones.sort(function(a,b){ return (b.fecha || '').localeCompare(a.fecha || ''); });
  return cotizaciones;
}

function obtenerCarteraClienteDesdeSheetDirecto(ss, idLimpia) {
  var hoja = ss.getSheetByName('SiigoCartera');
  var cartera = [];
  if (!hoja || hoja.getLastRow() <= 1) return cartera;

  var data = hoja.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    var ident = normalizarIdentificacion(data[i][5] || '');
    if (ident !== idLimpia) continue;
    cartera.push({
      id: String(data[i][0] || ''),
      facturaId: String(data[i][1] || ''),
      numero: String(data[i][2] || ''),
      fechaFactura: data[i][3] ? formatearFecha(data[i][3]) : '',
      fechaVencimiento: data[i][4] ? formatearFecha(data[i][4]) : '',
      clienteIdentificacion: ident,
      clienteNombre: String(data[i][6] || ''),
      vendedor: String(data[i][8] || ''),
      valorFactura: Number(data[i][9] || 0),
      saldo: Number(data[i][10] || 0),
      diasVencido: Number(data[i][11] || 0),
      estado: String(data[i][12] || ''),
    });
  }

  cartera.sort(function(a,b){ return (b.diasVencido || 0) - (a.diasVencido || 0); });
  return cartera;
}

function obtenerCarteraPendiente(body) {
  var ss = getOrCreateSheet();
  var hoja = ss.getSheetByName('SiigoCartera');
  var items = [];
  var resumen = { totalSaldo: 0, vencida: 0, porVencer: 0, totalFacturas: 0, totalClientes: 0 };
  var clientes = {};

  if (!hoja || hoja.getLastRow() <= 1) return { items: items, resumen: resumen };

  var data = hoja.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    var saldo = Number(data[i][10] || 0);
    if (saldo <= 0) continue;
    var ident = normalizarIdentificacion(data[i][5] || '');
    var item = {
      id: String(data[i][0] || ''),
      facturaId: String(data[i][1] || ''),
      numero: String(data[i][2] || ''),
      fechaFactura: data[i][3] ? formatearFecha(data[i][3]) : '',
      fechaVencimiento: data[i][4] ? formatearFecha(data[i][4]) : '',
      clienteIdentificacion: ident,
      clienteNombre: String(data[i][6] || ''),
      vendedor: String(data[i][8] || ''),
      valorFactura: Number(data[i][9] || 0),
      saldo: saldo,
      diasVencido: Number(data[i][11] || 0),
      estado: String(data[i][12] || ''),
    };
    items.push(item);
    resumen.totalSaldo += saldo;
    resumen.totalFacturas++;
    if (item.diasVencido > 0) resumen.vencida += saldo;
    else resumen.porVencer += saldo;
    if (ident) clientes[ident] = true;
  }

  resumen.totalClientes = Object.keys(clientes).length;
  items.sort(function(a,b){ return (b.diasVencido || 0) - (a.diasVencido || 0) || (b.saldo - a.saldo); });
  return { items: items, resumen: resumen };
}


// ============================================================
// CARRERA DE CABALLOS
// ============================================================

function carreraObtener() {
  var ss = getOrCreateSheet();
  var hoy = new Date();
  var hoyStr = Utilities.formatDate(hoy, 'GMT-5', 'yyyy-MM-dd');

  var hojaResumen = ss.getSheetByName('VentasVendedorDia');
  if (!hojaResumen || hojaResumen.getLastRow() <= 1) {
    return {
      fecha: hoyStr,
      mesAnio: Utilities.formatDate(hoy, 'GMT-5', 'yyyy-MM'),
      periodos: {
        hoy: { vendedores: [] },
        semana: { vendedores: [] },
        mes: { vendedores: [] }
      },
      metas: {},
      diasHabiles: {},
      debug: {
        modo: 'sin_resumen',
        mensaje: 'No hay resumen de carrera. En Admin → Siigo ejecuta Preparar carrera rápida.'
      }
    };
  }

  // Leer siempre desde la hoja resumen. Es rápido y evita mostrar valores viejos guardados en cache.
  var resultado = carreraObtenerDesdeResumen(ss);
  resultado.debug = resultado.debug || {};
  resultado.debug.cache = 'sin_cache_para_evitar_valores_viejos';
  return resultado;
}

function carreraObtenerDesdeResumen(ss) {
  var hoy = new Date();
  var hoyStr = Utilities.formatDate(hoy, 'GMT-5', 'yyyy-MM-dd');
  var mesAnio = Utilities.formatDate(hoy, 'GMT-5', 'yyyy-MM');
  var inicioMesStr = mesAnio + '-01';

  var inicioSem = new Date(hoy);
  inicioSem.setDate(hoy.getDate() - hoy.getDay()); // domingo
  var inicioSemStr = Utilities.formatDate(inicioSem, 'GMT-5', 'yyyy-MM-dd');

  var vendedores = cargarVendedoresCarrera(ss);
  var ventasHoy = {}, ventasSem = {}, ventasMes = {};
  var debug = { modo: 'resumen_diario', cache: 'miss', resumenFilasLeidas: 0, resumenFilasUsadas: 0 };

  var hojaResumen = ss.getSheetByName('VentasVendedorDia');
  if (hojaResumen && hojaResumen.getLastRow() > 1) {
    var rows = hojaResumen.getRange(2, 1, hojaResumen.getLastRow() - 1, 5).getValues();
    for (var i = 0; i < rows.length; i++) {
      debug.resumenFilasLeidas++;
      var fecha = rows[i][0];
      var fechaStr = (fecha instanceof Date) ? Utilities.formatDate(fecha, 'GMT-5', 'yyyy-MM-dd') : String(fecha).substring(0, 10);
      if (fechaStr < inicioMesStr || fechaStr > hoyStr) continue;
      var vendedorId = String(rows[i][1] || '');
      var total = Number(rows[i][3] || 0);
      if (!vendedorId || total <= 0) continue;
      debug.resumenFilasUsadas++;
      ventasMes[vendedorId] = (ventasMes[vendedorId] || 0) + total;
      if (fechaStr >= inicioSemStr) ventasSem[vendedorId] = (ventasSem[vendedorId] || 0) + total;
      if (fechaStr === hoyStr) ventasHoy[vendedorId] = (ventasHoy[vendedorId] || 0) + total;
    }
  }

  var metas = cargarMetasCarrera(ss, mesAnio);
  var diasHabiles = cargarDiasCarrera(ss, mesAnio);

  function armarPeriodo(nombre, ventasMap) {
    var lista = [];
    for (var i = 0; i < vendedores.length; i++) {
      var v = vendedores[i];
      var vendido = Math.round(ventasMap[v.siigoUserId] || 0);
      var meta = metas[String(v.username).toLowerCase()] || 0;
      var falta = Math.max(0, meta - vendido);
      var pct = meta > 0 ? Math.round((vendido / meta) * 1000) / 10 : 0;
      lista.push({
        username: v.username,
        nombre: v.nombre,
        siigoUserId: v.siigoUserId,
        ventas: vendido,
        vendido: vendido,
        meta: meta,
        falta: falta,
        porcentaje: pct,
        diasHabiles: diasHabiles[String(v.username).toLowerCase()] || [],
      });
    }
    lista.sort(function(a,b){ return b.vendido - a.vendido; });
    return { nombre: nombre, vendedores: lista };
  }

  return {
    fecha: hoyStr,
    mesAnio: mesAnio,
    debug: debug,
    periodos: {
      hoy: armarPeriodo('Hoy', ventasHoy),
      semana: armarPeriodo('Semana', ventasSem),
      mes: armarPeriodo('Mes', ventasMes),
    }
  };
}

function cargarVendedoresCarrera(ss) {
  var hojaU = ss.getSheetByName('Usuarios');
  var users = hojaU.getDataRange().getValues();
  var vendedores = [];
  for (var i = 1; i < users.length; i++) {
    var activo = users[i][6] === true || String(users[i][6]).toLowerCase() === 'true';
    var sid = String(users[i][11] || '');
    if (activo && sid) {
      vendedores.push({ username: String(users[i][0]), nombre: String(users[i][1]), siigoUserId: sid });
    }
  }
  return vendedores;
}

function cargarMetasCarrera(ss, mesAnio) {
  var h = ss.getSheetByName('MetasCarrera');
  var metas = {};
  if (h && h.getLastRow() > 1) {
    var d = h.getDataRange().getValues();
    for (var i = 1; i < d.length; i++) {
      if (String(d[i][2]) === mesAnio) metas[String(d[i][0]).toLowerCase()] = Number(d[i][1] || 0);
    }
  }
  return metas;
}

function cargarDiasCarrera(ss, mesAnio) {
  var h = ss.getSheetByName('DiasHabiles');
  var dias = {};
  if (h && h.getLastRow() > 1) {
    var d = h.getDataRange().getValues();
    for (var i = 1; i < d.length; i++) {
      if (String(d[i][1]) === mesAnio) {
        try { dias[String(d[i][0]).toLowerCase()] = JSON.parse(d[i][2] || '[]'); } catch(e) { dias[String(d[i][0]).toLowerCase()] = []; }
      }
    }
  }
  return dias;
}

function reconstruirResumenCarrera() {
  // Para la carrera del día, Siigo se debe leer directo por API y usando el TOTAL de la factura.
  // Así se parece al reporte de Siigo "ventas por vendedor" y no queda con resumen viejo.
  var r = actualizarResumenCarreraHoyDesdeSiigo();
  registrarLog('reconstruir_carrera_hoy_siigo', 'sistema', JSON.stringify(r));
  return r;
}


function actualizarResumenCarreraHoyDesdeSiigo() {
  var ss = getOrCreateSheet();
  asegurarHojaVentasVendedorDia(ss);

  var hoy = new Date();
  var fecha = Utilities.formatDate(hoy, 'GMT-5', 'yyyy-MM-dd');
  var manana = new Date(hoy);
  manana.setDate(manana.getDate() + 1);
  var hasta = Utilities.formatDate(manana, 'GMT-5', 'yyyy-MM-dd');

  var facturas = [];
  try {
    // Este filtro es el más parecido al reporte diario de Siigo: documentos creados en el día.
    facturas = siigoFetchAll('/v1/invoices', {
      created_start: fecha,
      created_end: hasta
    }, 20);
  } catch (e) {
    return { error: 'No se pudo consultar Siigo para la carrera: ' + e.message, fecha: fecha };
  }

  var grupos = {};
  var ids = {};
  var debug = { fecha: fecha, facturasApi: facturas.length, usadas: 0, invalidas: 0, sinVendedor: 0, duplicadas: 0, grupos: 0 };

  for (var i = 0; i < facturas.length; i++) {
    var f = facturas[i] || {};
    var fid = String(f.id || f.name || f.number || '');
    if (!fid || ids[fid]) { debug.duplicadas++; continue; }
    ids[fid] = true;

    var tipoDoc = f.document ? String(f.document.name || f.document.code || '') : '';
    var estado = String(f.annulled ? 'annulled' : (f.status || ''));
    var vendedorId = extraerVendedorIdSiigo(f);
    var vendedor = extraerVendedorNombreSiigo(f);
    var total = totalFacturaSiigoParaCarrera(f);

    if (!esTipoDocumentoVentaValido(tipoDoc) || !esFacturaVentaValida(estado) || total <= 0) {
      debug.invalidas++;
      continue;
    }
    if (!vendedorId) {
      debug.sinVendedor++;
      continue;
    }

    debug.usadas++;
    var key = vendedorId;
    if (!grupos[key]) grupos[key] = { fecha: fecha, vendedorId: vendedorId, vendedor: vendedor, total: 0, facturas: 0 };
    grupos[key].total += total;
    grupos[key].facturas += 1;
    if (vendedor && !grupos[key].vendedor) grupos[key].vendedor = vendedor;
  }

  reemplazarVentasVendedorDia(ss, fecha, grupos);
  debug.grupos = Object.keys(grupos).length;
  debug.mensaje = 'Carrera de hoy actualizada desde Siigo usando TOTAL con IVA.';
  invalidarCacheCarrera(false);
  return debug;
}

function totalFacturaSiigoParaCarrera(f) {
  if (!f) return 0;
  var total = Number(f.total || 0);
  if (total > 0) return total;
  var subtotal = Number(f.subtotal || f.total_before_taxes || f.gross_value || 0);
  var impuestos = Number(f.total_taxes || f.taxes || f.tax_amount || 0);
  var retencion = Number(f.tax_retention || f.total_retention || 0);
  var calculado = subtotal + impuestos - retencion;
  if (calculado > 0) return calculado;
  if (f.payments && f.payments.length > 0) {
    var sumaPagos = 0;
    for (var i = 0; i < f.payments.length; i++) {
      sumaPagos += Number(f.payments[i].value || f.payments[i].total || 0);
    }
    if (sumaPagos > 0) return sumaPagos;
  }
  if (f.items && f.items.length > 0) {
    var sumaItems = 0;
    for (var j = 0; j < f.items.length; j++) {
      sumaItems += Number(f.items[j].total || 0);
    }
    if (sumaItems > 0) return sumaItems;
  }
  return 0;
}

function asegurarHojaVentasVendedorDia(ss) {
  var hojaR = ss.getSheetByName('VentasVendedorDia');
  if (!hojaR) {
    hojaR = ss.insertSheet('VentasVendedorDia');
    hojaR.appendRow(['Fecha','VendedorId','Vendedor','Total','Facturas','Actualizado']);
    hojaR.getRange(1, 1, 1, 6).setFontWeight('bold').setBackground('#D97706').setFontColor('white');
  }
  return hojaR;
}

function reemplazarVentasVendedorDia(ss, fecha, grupos) {
  var hojaR = asegurarHojaVentasVendedorDia(ss);

  // Borrar solo el día que se está recalculando. No toca mes/semana anterior.
  if (hojaR.getLastRow() > 1) {
    var datos = hojaR.getRange(2, 1, hojaR.getLastRow() - 1, 1).getValues();
    for (var i = datos.length - 1; i >= 0; i--) {
      var v = datos[i][0];
      var fechaFila = (v instanceof Date) ? Utilities.formatDate(v, 'GMT-5', 'yyyy-MM-dd') : String(v).substring(0, 10);
      if (fechaFila === fecha) hojaR.deleteRow(i + 2);
    }
  }

  var ahora = new Date();
  var filas = [];
  for (var k in grupos) {
    filas.push([fecha, grupos[k].vendedorId, grupos[k].vendedor, Math.round(grupos[k].total), grupos[k].facturas, ahora]);
  }
  filas.sort(function(a, b) { return String(a[2]).localeCompare(String(b[2])); });
  if (filas.length > 0) {
    hojaR.getRange(hojaR.getLastRow() + 1, 1, filas.length, 6).setValues(filas);
  }
}

function reconstruirVentasVendedorDia(ss) {
  ss = ss || getOrCreateSheet();
  var hojaF = ss.getSheetByName('SiigoFacturas');
  var hojaR = ss.getSheetByName('VentasVendedorDia');
  if (!hojaR) {
    hojaR = ss.insertSheet('VentasVendedorDia');
    hojaR.appendRow(['Fecha','VendedorId','Vendedor','Total','Facturas','Actualizado']);
  }
  if (hojaR.getLastRow() > 1) hojaR.getRange(2, 1, hojaR.getLastRow() - 1, hojaR.getLastColumn()).clearContent();

  var debug = { facturasLeidas: 0, usadas: 0, duplicadas: 0, invalidas: 0, sinVendedor: 0, grupos: 0 };
  if (!hojaF || hojaF.getLastRow() <= 1) {
    invalidarCacheCarrera(false);
    return debug;
  }

  var rows = hojaF.getRange(2, 1, hojaF.getLastRow() - 1, 13).getValues();
  var idsUsados = {};
  var grupos = {};

  for (var r = 0; r < rows.length; r++) {
    debug.facturasLeidas++;
    var fid = String(rows[r][0] || '');
    if (!fid || idsUsados[fid]) { debug.duplicadas++; continue; }
    idsUsados[fid] = true;

    var fecha = rows[r][2];
    var fechaStr = (fecha instanceof Date) ? Utilities.formatDate(fecha, 'GMT-5', 'yyyy-MM-dd') : String(fecha).substring(0, 10);
    if (!fechaStr) continue;

    var tipoDoc = String(rows[r][3] || '');
    var vendedorId = String(rows[r][6] || '');
    var vendedor = String(rows[r][7] || '');
    var total = Number(rows[r][11] || 0);
    var estado = String(rows[r][12] || '');

    if (!esTipoDocumentoVentaValido(tipoDoc) || !esFacturaVentaValida(estado) || total <= 0) {
      debug.invalidas++;
      continue;
    }
    if (!vendedorId) {
      debug.sinVendedor++;
      continue;
    }

    debug.usadas++;
    var key = fechaStr + '|' + vendedorId;
    if (!grupos[key]) grupos[key] = { fecha: fechaStr, vendedorId: vendedorId, vendedor: vendedor, total: 0, facturas: 0 };
    grupos[key].total += total;
    grupos[key].facturas += 1;
    if (vendedor && !grupos[key].vendedor) grupos[key].vendedor = vendedor;
  }

  var ahora = new Date();
  var filas = [];
  for (var k in grupos) {
    filas.push([grupos[k].fecha, grupos[k].vendedorId, grupos[k].vendedor, Math.round(grupos[k].total), grupos[k].facturas, ahora]);
  }
  filas.sort(function(a,b){ return String(a[0]).localeCompare(String(b[0])) || String(a[2]).localeCompare(String(b[2])); });

  if (filas.length > 0) {
    for (var i = 0; i < filas.length; i += 1000) {
      var chunk = filas.slice(i, i + 1000);
      hojaR.getRange(i + 2, 1, chunk.length, 6).setValues(chunk);
    }
  }
  debug.grupos = filas.length;
  invalidarCacheCarrera(false);
  return debug;
}

function invalidarResumenCarrera() {
  var props = PropertiesService.getScriptProperties();
  props.setProperty('carrera_resumen_stale', 'true');
}

function invalidarCacheCarrera(marcarStale) {
  var props = PropertiesService.getScriptProperties();
  props.setProperty('carrera_cache_version', String(Date.now()));
  if (marcarStale === false) props.deleteProperty('carrera_resumen_stale');
  else props.setProperty('carrera_resumen_stale', 'true');
}


function carreraGuardarMeta(username, meta, mesAnio) {
  if (!username) return { error: 'Falta username' };
  var ss = getOrCreateSheet();
  var hoja = ss.getSheetByName('MetasCarrera');
  var ahora = new Date();
  var data = hoja.getDataRange().getValues();
  
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).toLowerCase() === String(username).toLowerCase() && String(data[i][2]) === mesAnio) {
      hoja.getRange(i + 1, 2).setValue(Number(meta) || 0);
      hoja.getRange(i + 1, 4).setValue(ahora);
      invalidarCacheCarrera(false);
      return { ok: true };
    }
  }
  hoja.appendRow([username, Number(meta) || 0, mesAnio, ahora]);
  invalidarCacheCarrera(false);
  return { ok: true };
}

function carreraGuardarDias(username, dias, mesAnio) {
  if (!username) return { error: 'Falta username' };
  var ss = getOrCreateSheet();
  var hoja = ss.getSheetByName('DiasHabiles');
  var ahora = new Date();
  var diasJSON = JSON.stringify(dias || []);
  var data = hoja.getDataRange().getValues();
  
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).toLowerCase() === String(username).toLowerCase() && String(data[i][1]) === mesAnio) {
      hoja.getRange(i + 1, 3).setValue(diasJSON);
      hoja.getRange(i + 1, 4).setValue(ahora);
      invalidarCacheCarrera(false);
      return { ok: true };
    }
  }
  hoja.appendRow([username, mesAnio, diasJSON, ahora]);
  invalidarCacheCarrera(false);
  return { ok: true };
}

// ============================================================
// UTILIDAD: REINICIAR COTIZACIONES PARA RECALCULAR IVA INCLUIDO
// ============================================================
function reiniciarCotizacionesSiigo() {
  var ss = getOrCreateSheet();

  var hojas = [
    'SiigoCotizaciones',
    'SiigoCotizacionItems',
    'CotizacionesClienteCache'
  ];

  for (var i = 0; i < hojas.length; i++) {
    var h = ss.getSheetByName(hojas[i]);
    if (h && h.getLastRow() > 1) {
      h.getRange(2, 1, h.getLastRow() - 1, h.getLastColumn()).clearContent();
    }
  }

  registrarLog('reiniciar_cotizaciones', 'sistema', 'Cotizaciones limpiadas para recalcular IVA incluido');

  return {
    status: 'ok',
    mensaje: 'Cotizaciones reiniciadas. Ahora ejecuta Actualizar cotizaciones desde 2022.'
  };
}
// ============================================================
//  FUNCION 1:  sincronizarProductosSiigo   (REEMPLAZA la que ya tienes)
//  Cambio: ahora tambien guarda el % de IVA de cada producto.
// ============================================================
function sincronizarProductosSiigo() {
  var productos = siigoFetchAll('/v1/products', {}, 100);

  var ss = getOrCreateSheet();
  var hoja = ss.getSheetByName('SiigoProductos');

  // Asegurar el encabezado de la columna IVA (columna 8)
  hoja.getRange(1, 8).setValue('IVA');

  // Limpiar y reescribir (es rapido para productos)
  if (hoja.getLastRow() > 1) hoja.getRange(2, 1, hoja.getLastRow() - 1, hoja.getLastColumn()).clear();

  var ahora = new Date();
  var filas = [];
  for (var i = 0; i < productos.length; i++) {
    var p = productos[i];
    var precio = 0;
    if (p.prices && p.prices.length > 0 && p.prices[0].price_list && p.prices[0].price_list.length > 0) {
      precio = p.prices[0].price_list[0].value || 0;
    }

    // Extraer el % de IVA real del producto (0 si es exento/excluido)
    var iva = 0;
    var taxes = p.taxes || [];
    for (var t = 0; t < taxes.length; t++) {
      iva += Number(taxes[t].percentage || taxes[t].rate || taxes[t].percent || 0);
    }

    filas.push([
      String(p.id || ''),
      String(p.code || ''),
      String(p.name || ''),
      precio,
      p.account_group ? String(p.account_group.name || '') : '',
      p.active !== false,
      ahora,
      iva   // columna 8: IVA del producto
    ]);
  }

  if (filas.length > 0) {
    // Batch write en chunks de 1000 (ahora son 8 columnas)
    for (var i = 0; i < filas.length; i += 1000) {
      var chunk = filas.slice(i, i + 1000);
      hoja.getRange(i + 2, 1, chunk.length, 8).setValues(chunk);
    }
  }

  return { total: productos.length };
}


// ============================================================
//  FUNCION 2:  procesarClientesSiigo   (REEMPLAZA la que ya tienes)
//  Cambios:
//   - Aplica el IVA REAL de cada producto al precio unitario.
//   - EXCLUYE los clientes desactivados.
// ============================================================
function procesarClientesSiigo() {
  var ss = getOrCreateSheet();
  var hojaC = ss.getSheetByName('SiigoClientes');
  var hojaF = ss.getSheetByName('SiigoFacturas');
  var hojaI = ss.getSheetByName('SiigoFacturaItems');

  if (!hojaC || hojaC.getLastRow() < 2) return { error: 'No hay clientes sincronizados' };

  var clientesData = hojaC.getDataRange().getValues();
  var facturasData = hojaF && hojaF.getLastRow() > 1 ? hojaF.getDataRange().getValues() : [];
  var itemsData = hojaI && hojaI.getLastRow() > 1 ? hojaI.getDataRange().getValues() : [];

  // ---- Mapa de IVA por producto (codigo y nombre) desde SiigoProductos ----
  var hojaP = ss.getSheetByName('SiigoProductos');
  var ivaPorCodigo = {};
  var ivaPorNombre = {};
  if (hojaP && hojaP.getLastRow() > 1) {
    var prodData = hojaP.getDataRange().getValues();
    for (var pi = 1; pi < prodData.length; pi++) {
      var pcod = String(prodData[pi][1] || '').trim().toUpperCase();
      var pnom = String(prodData[pi][2] || '').trim().toUpperCase();
      var piva = Number(prodData[pi][7] || 0); // columna 8 = IVA
      if (pcod) ivaPorCodigo[pcod] = piva;
      if (pnom) ivaPorNombre[pnom] = piva;
    }
  }

  // Indexar items por FacturaId (ahora incluye el codigo del producto)
  var itemsPorFactura = {};
  for (var i = 1; i < itemsData.length; i++) {
    var fid = String(itemsData[i][0]);
    if (!itemsPorFactura[fid]) itemsPorFactura[fid] = [];
    itemsPorFactura[fid].push({
      producto: String(itemsData[i][1] || ''),
      codigo: String(itemsData[i][2] || ''),
      cantidad: Number(itemsData[i][3] || 0),
      precioUnit: Number(itemsData[i][4] || 0),
      valor: Number(itemsData[i][6] || 0),
    });
  }

  // Agrupar facturas por identificacion de cliente
  var facturasPorCliente = {};
  var facturasProcesadas = {};
  for (var i = 1; i < facturasData.length; i++) {
    var fidProcesar = String(facturasData[i][0] || '');
    if (!fidProcesar || facturasProcesadas[fidProcesar]) continue;
    facturasProcesadas[fidProcesar] = true;

    var tipoDocFactura = String(facturasData[i][3] || '');
    var estadoFactura = String(facturasData[i][12] || '');
    if (!esTipoDocumentoVentaValido(tipoDocFactura) || !esFacturaVentaValida(estadoFactura)) continue;

    var ident = normalizarIdentificacion(facturasData[i][5] || '');
    if (!ident) continue;
    if (!facturasPorCliente[ident]) facturasPorCliente[ident] = [];
    facturasPorCliente[ident].push({
      id: fidProcesar,
      fecha: facturasData[i][2],
      total: valorFacturaVenta(facturasData[i]),
      vendedor: String(facturasData[i][7] || ''),
      estado: estadoFactura,
      tipoDoc: tipoDocFactura,
    });
  }

  var hoy = new Date();
  var clientes = [];
  var mapaProductosCliente = {};
  var ventasMensualesGlobal = {};

  for (var ci = 1; ci < clientesData.length; ci++) {
    var c = clientesData[ci];
    var ident = String(c[1] || '').split('-')[0].trim();
    if (!ident) continue;

    // EXCLUIR clientes desactivados (columna Activo = FALSE)
    var clienteActivo = (c[4] === true || String(c[4]).toUpperCase() === 'TRUE');
    if (!clienteActivo) continue;

    var facturas = facturasPorCliente[ident] || [];

    var fechas = [];
    var total = 0;
    var vendedores = {};
    var ultimoVendedor = '';
    var _ultVendMs = 0;
    var productosAcum = {};
    var comprasPorMesObj = {};

    for (var k = 0; k < facturas.length; k++) {
      var f = facturas[k];
      total += f.total;
      var fch = null;
      if (f.fecha) {
        fch = (f.fecha instanceof Date) ? f.fecha : new Date(f.fecha);
        if (isNaN(fch.getTime())) fch = null;
      }
      if (fch) {
        fechas.push(fch);
        var mes = Utilities.formatDate(fch, 'GMT-5', 'yyyy-MM');
        comprasPorMesObj[mes] = (comprasPorMesObj[mes] || 0) + f.total;
        ventasMensualesGlobal[mes] = (ventasMensualesGlobal[mes] || 0) + f.total;
      }
      if (f.vendedor) vendedores[f.vendedor] = (vendedores[f.vendedor] || 0) + 1;
      if (fch && f.vendedor) {
        var vms = fch.getTime();
        if (vms >= _ultVendMs) { _ultVendMs = vms; ultimoVendedor = f.vendedor; }
      }

      var its = itemsPorFactura[f.id] || [];
      for (var p = 0; p < its.length; p++) {
        var nom = its[p].producto || 'Producto';
        if (!productosAcum[nom]) productosAcum[nom] = { nombre: nom, cantidad: 0, valor: 0, ultimaFecha: '', ultimaCantidad: 0, ultimoPrecioUnit: 0, _ultMs: 0, _primMs: 0, vecesComprado: 0, meses: {} };
        productosAcum[nom].cantidad += its[p].cantidad;
        productosAcum[nom].valor += its[p].valor;
        productosAcum[nom].vecesComprado += 1;
        if (fch) {
          var fStr = Utilities.formatDate(fch, 'GMT-5', 'yyyy-MM');
          var ms = fch.getTime();
          productosAcum[nom].meses[fStr] = true;
          if (!productosAcum[nom]._primMs || ms < productosAcum[nom]._primMs) productosAcum[nom]._primMs = ms;
          if (ms >= productosAcum[nom]._ultMs) {
            productosAcum[nom]._ultMs = ms;
            productosAcum[nom].ultimaFecha = fStr;
            productosAcum[nom].ultimaCantidad = its[p].cantidad;

            // El precio unitario guardado en SiigoFacturaItems YA incluye el IVA real
            // de la linea y el descuento aplicado (se calcula una sola vez al sincronizar
            // la factura). Volver a aplicarle aqui el IVA del catalogo duplicaba el
            // impuesto y mostraba un precio inflado que no coincidia con la factura real.
            productosAcum[nom].ultimoPrecioUnit = its[p].precioUnit;
          }
        }
      }
    }
    fechas.sort(function(a, b){ return a - b; });

    var numCompras = facturas.length;
    var primeraCompra = fechas.length > 0 ? Utilities.formatDate(fechas[0], 'GMT-5', 'yyyy-MM') : '';
    var ultimaCompra = fechas.length > 0 ? Utilities.formatDate(fechas[fechas.length-1], 'GMT-5', 'yyyy-MM') : '';

    var frecuencia = null;
    if (fechas.length >= 2) {
      var difTotal = 0;
      for (var k = 1; k < fechas.length; k++) difTotal += (fechas[k] - fechas[k-1]) / 86400000;
      frecuencia = Math.round(difTotal / (fechas.length - 1));
    }

    var diasDesde = fechas.length > 0 ? Math.floor((hoy - fechas[fechas.length-1]) / 86400000) : 9999;
    var mesesSinComprar = fechas.length > 0 ? Math.floor(diasDesde / 30) : 999;
    var estado = calcularEstadoCliente(diasDesde, frecuencia || 0, numCompras);

    var mesesActivos = Object.keys(comprasPorMesObj).length;
    var ticketMes = mesesActivos > 0 ? Math.round(total / mesesActivos) : 0;

    var vendedorPrincipal = '';
    var maxV = 0;
    for (var v in vendedores) { if (vendedores[v] > maxV) { maxV = vendedores[v]; vendedorPrincipal = v; } }

    var listaProd = [];
    for (var nom in productosAcum) {
      var pa = productosAcum[nom];
      listaProd.push({
        nombre: pa.nombre,
        cantidad: Math.round(pa.cantidad * 100) / 100,
        cantTotal: Math.round(pa.cantidad * 100) / 100,
        valor: Math.round(pa.valor),
        valorTotal: Math.round(pa.valor),
        vecesComprado: pa.vecesComprado || 0,
        ultimoMes: pa.ultimaFecha,
        ultimaCantidad: Math.round(pa.ultimaCantidad * 100) / 100,
        ultimoPrecioUnit: Math.round(pa.ultimoPrecioUnit),
      });
    }
    var topProductos = listaProd.slice().sort(function(a,b){ return b.valor - a.valor; }).slice(0, 10);
    var todosProductos = listaProd.sort(function(a,b){ return (b.ultimoMes||'').localeCompare(a.ultimoMes||''); });
    var cambioPatron = detectarCambioPatronProductos(productosAcum, fechas, frecuencia);

    var comprasPorMes = [];
    var mesesOrden = Object.keys(comprasPorMesObj).sort();
    for (var m = 0; m < mesesOrden.length; m++) {
      comprasPorMes.push({ mes: mesesOrden[m], valor: Math.round(comprasPorMesObj[mesesOrden[m]]) });
    }

    var tipoPersona = String(c[3] || '');
    var esEmpresa = (tipoPersona === 'Company' || tipoPersona === 'Empresa');
    var tipo = esEmpresa ? 'empresa' : 'hogar';
    var tel = String(c[7] || '').trim();

    // Todo el detalle historico pesado (productos y compras mes a mes) se guarda
    // aparte, por cliente, y se trae solo cuando alguien abre SU ficha -- no hace
    // falta para la lista/dashboard, y es lo que hacia pesar el cache original.
    mapaProductosCliente[ident] = {
      todosProductos: todosProductos,
      topProductos: topProductos,
      comprasPorMes: comprasPorMes,
      topGrupos: total > 0 ? [{ grupo: 'Productos', valor: Math.round(total) }] : [],
    };

    clientes.push({
      id: ident,
      nombre: String(c[2] || ''),
      tipo: tipo,
      esEmpresa: esEmpresa,
      tipoId: esEmpresa ? 'NIT' : 'CC',
      telefonos: tel ? [tel] : [],
      telefonosFormat: tel ? [tel] : [],
      correo: String(c[8] || ''),
      direccion: String(c[6] || ''),
      ciudad: String(c[5] || ''),
      contacto: String(c[2] || ''),
      vendedor: vendedorPrincipal,
      ultimoVendedor: ultimoVendedor,
      total: Math.round(total),
      mesesActivos: mesesActivos,
      frecuenciaDias: frecuencia,
      ticketMes: ticketMes,
      primeraCompra: primeraCompra,
      ultimaCompra: ultimaCompra,
      mesesSinComprar: mesesSinComprar,
      numCompras: numCompras,
      estado: estado,
      cambioPatron: cambioPatron,
    });
  }

  // ----- GLOBAL para el dashboard -----
  var ventasMensuales = [];
  var mesesG = Object.keys(ventasMensualesGlobal).sort();
  for (var m = 0; m < mesesG.length; m++) {
    ventasMensuales.push([mesesG[m], Math.round(ventasMensualesGlobal[mesesG[m]])]);
  }
  var topClientes = clientes.slice().sort(function(a,b){ return b.total - a.total; }).slice(0, 10)
    .map(function(c){ return { id: c.id, nombre: c.nombre, total: c.total, estado: c.estado }; });
  var perdidosValiosos = clientes.filter(function(c){ return c.estado === 'perdido' && c.total > 0; })
    .sort(function(a,b){ return b.total - a.total; }).slice(0, 12)
    .map(function(c){ return { id: c.id, nombre: c.nombre, total: c.total, mesesSinComprar: c.mesesSinComprar }; });

  var global = {
    ventasMensuales: ventasMensuales,
    topClientes: topClientes,
    perdidosValiosos: perdidosValiosos,
  };

  var payload = JSON.stringify({ clientes: clientes, global: global });
  var hojaCache = ss.getSheetByName('DatosCache');
  if (!hojaCache) hojaCache = ss.insertSheet('DatosCache');
  if (hojaCache.getLastRow() > 0) hojaCache.clearContents();

  var chunkSize = 45000;
  var filas = [];
  for (var i = 0; i < payload.length; i += chunkSize) filas.push([payload.substring(i, i + chunkSize)]);
  if (filas.length > 0) hojaCache.getRange(1, 1, filas.length, 1).setValues(filas);

  // Guardar el detalle de productos por cliente aparte (evita que la lista pese 30+MB).
  // Se reintenta porque el servicio de Sheets puede quedar temporalmente sobrecargado
  // justo despues de las lecturas/escrituras grandes de arriba (error real visto:
  // "Service Spreadsheets timed out") -- casi siempre se resuelve solo si se reintenta
  // unos segundos despues.
  for (var intentoProd = 0; intentoProd < 3; intentoProd++) {
    try {
      var hojaProd = ss.getSheetByName('ProductosClienteCache');
      if (!hojaProd) {
        hojaProd = ss.insertSheet('ProductosClienteCache');
        hojaProd.getRange(1, 1, 1, 4).setValues([['Identificacion', 'Chunk', 'JSON', 'Fecha']]);
      }
      guardarJSONPorClienteEnChunks(ss, 'ProductosClienteCache', mapaProductosCliente, null);
      break;
    } catch (errProd) {
      if (intentoProd >= 2) throw errProd;
      Utilities.sleep(5000);
    }
  }

  var props = PropertiesService.getScriptProperties();
  props.setProperty('clientes_cache_fecha', hoy.toISOString());
  props.setProperty('clientes_cache_count', String(clientes.length));

  var conCompras = 0, activos = 0, perdidos = 0;
  for (var i = 0; i < clientes.length; i++) {
    if (clientes[i].numCompras > 0) conCompras++;
    if (clientes[i].estado === 'activo') activos++;
    if (clientes[i].estado === 'perdido') perdidos++;
  }

  return {
    clientesProcesados: clientes.length,
    conCompras: conCompras,
    activos: activos,
    perdidos: perdidos,
    tamanoKB: Math.round(payload.length / 1024),
    chunks: filas.length,
  };
}
// ============================================================
// AUTO-ASIGNACIÓN DE VENDEDORES A CLIENTES
// Para cada cliente con historial de facturas, determina el vendedor
// ACTIVO que más veces lo ha facturado (desempate: el más reciente).
// Si el vendedor con más facturas está INACTIVO en el sistema, el cliente
// queda SIN ASIGNAR (se borra su fila de Asignaciones).
// Clientes sin ninguna factura: no se tocan.
//
// Ejecutar desde el editor de Apps Script → Run → autoAsignarVendedoresClientes
// Después correr procesarClientesSiigo para que la app refleje los cambios.
// ============================================================
function autoAsignarVendedoresClientes() {
  var ss = getOrCreateSheet();

  // 1. Construir mapa SiigoUserId → { username, activo }
  var hojaU = ss.getSheetByName('Usuarios');
  // Usuarios: Username(0), NombreCompleto(1), Rol(2), ..., Activo(6), ..., SiigoUserId(11)
  var dataU = hojaU.getDataRange().getValues();
  var siigoIdAUsuario = {}; // SiigoUserId → username
  var usuarioActivo   = {}; // username → true/false
  for (var u = 1; u < dataU.length; u++) {
    var siigoUId = String(dataU[u][11] || '').trim();
    var uname    = String(dataU[u][0]  || '').toLowerCase().trim();
    var activo   = dataU[u][6] === true || String(dataU[u][6]).toLowerCase() === 'true';
    if (siigoUId && uname) {
      siigoIdAUsuario[siigoUId] = uname;
      usuarioActivo[uname]      = activo;
    }
  }

  // 2. Leer SiigoFacturas y acumular conteos por cliente
  var hojaF = ss.getSheetByName('SiigoFacturas');
  // SiigoFacturas: ClienteId(4), VendedorId(6), Fecha(2)
  var dataF = hojaF.getDataRange().getValues();
  // estructura: clienteStats[clienteId][vendedorId] = { count, ultimaFecha }
  var clienteStats = {};
  for (var f = 1; f < dataF.length; f++) {
    var cid  = String(dataF[f][4] || '').trim();
    var vid  = String(dataF[f][6] || '').trim();
    var fech = dataF[f][2];
    if (!cid || !vid) continue;
    if (!clienteStats[cid]) clienteStats[cid] = {};
    if (!clienteStats[cid][vid]) clienteStats[cid][vid] = { count: 0, ultimaFecha: null };
    clienteStats[cid][vid].count++;
    var fechaMs = fech ? (fech instanceof Date ? fech.getTime() : new Date(String(fech).substring(0,10)).getTime()) : 0;
    if (!clienteStats[cid][vid].ultimaFecha || fechaMs > clienteStats[cid][vid].ultimaFecha) {
      clienteStats[cid][vid].ultimaFecha = fechaMs;
    }
  }

  // 3. Para cada cliente, elegir el vendedor ganador
  // Regla: más facturas → gana; empate → más reciente. Luego verificar que esté activo.
  var ahora = new Date();
  var asignacionesNuevas = {}; // clienteId → username (o '' si sin asignar)
  for (var cid in clienteStats) {
    var vendedores = clienteStats[cid];
    var ganadorVid = null;
    var maxCount   = 0;
    var maxFecha   = 0;
    for (var vid in vendedores) {
      var s = vendedores[vid];
      if (s.count > maxCount || (s.count === maxCount && s.ultimaFecha > maxFecha)) {
        maxCount   = s.count;
        maxFecha   = s.ultimaFecha;
        ganadorVid = vid;
      }
    }
    var ganadorUsername = ganadorVid ? (siigoIdAUsuario[ganadorVid] || '') : '';
    // Si el ganador existe en el sistema y está ACTIVO, asignar; si no, dejar sin asignar
    if (ganadorUsername && usuarioActivo[ganadorUsername]) {
      asignacionesNuevas[cid] = ganadorUsername;
    } else {
      asignacionesNuevas[cid] = ''; // sin asignar
    }
  }

  // 4. Reconstruir la hoja Asignaciones
  var hojaAsig = ss.getSheetByName('Asignaciones');
  var dataAsig = hojaAsig.getDataRange().getValues();
  // Asignaciones: ClienteID(0), Vendedor(1), Actualizado(2)
  // Conservar asignaciones de clientes SIN historial de facturas (no los tocamos)
  var nuevasFilas = [dataAsig[0]]; // cabecera
  var yaProcesados = {};
  for (var a = 1; a < dataAsig.length; a++) {
    var acid = String(dataAsig[a][0] || '').trim();
    if (!acid) continue;
    yaProcesados[acid] = true;
    if (asignacionesNuevas.hasOwnProperty(acid)) {
      // Cliente con historial → usar nuevo valor (solo si tiene asignación activa)
      if (asignacionesNuevas[acid]) {
        nuevasFilas.push([acid, asignacionesNuevas[acid], ahora]);
      }
      // si asignacionesNuevas[acid] === '' → no agregar fila = sin asignar
    } else {
      nuevasFilas.push(dataAsig[a]); // sin historial → conservar
    }
  }
  // Agregar clientes con historial que aún no tenían fila en Asignaciones
  for (var ncid in asignacionesNuevas) {
    if (!yaProcesados[ncid] && asignacionesNuevas[ncid]) {
      nuevasFilas.push([ncid, asignacionesNuevas[ncid], ahora]);
    }
  }

  hojaAsig.clearContents();
  if (nuevasFilas.length > 0) {
    hojaAsig.getRange(1, 1, nuevasFilas.length, nuevasFilas[0].length).setValues(nuevasFilas);
  }

  var conAsignacion = 0, sinAsignacion = 0;
  for (var k in asignacionesNuevas) {
    if (asignacionesNuevas[k]) conAsignacion++; else sinAsignacion++;
  }
  Logger.log('Auto-asignación completa. Con vendedor activo: ' + conAsignacion + ', sin asignar (inactivo/no encontrado): ' + sinAsignacion);
  return { conVendedor: conAsignacion, sinAsignar: sinAsignacion };
}

function arreglarPermisosUsuarios() {
  var ss = getOrCreateSheet();
  var hoja = ss.getSheetByName('Usuarios');
  var data = hoja.getDataRange().getValues();
  var n = 0;
  for (var i = 1; i < data.length; i++) {
    var rol = String(data[i][2] || '');
    if (ROLES[rol]) {
      hoja.getRange(i + 1, 4).setValue(JSON.stringify(ROLES[rol].permisos));
      n++;
    }
  }
  Logger.log('Permisos actualizados: ' + n);
}
function compactarVentasVendedorDia() {
  var ss = getOrCreateSheet();
  var hojaR = ss.getSheetByName('VentasVendedorDia');
  if (!hojaR || hojaR.getLastRow() <= 1) { Logger.log('Hoja vacía'); return; }

  var corte = new Date();
  corte.setDate(corte.getDate() - 95);
  var corteStr = Utilities.formatDate(corte, 'GMT-5', 'yyyy-MM-dd');

  var total = hojaR.getLastRow() - 1;
  var datos = hojaR.getRange(2, 1, total, 5).getValues();
  var ahora = new Date();
  var filas = [];
  for (var i = 0; i < datos.length; i++) {
    var v = datos[i][0];
    var f = (v instanceof Date) ? Utilities.formatDate(v, 'GMT-5', 'yyyy-MM-dd') : String(v).substring(0, 10);
    if (f >= corteStr) filas.push([datos[i][0], datos[i][1], datos[i][2], datos[i][3], datos[i][4], ahora]);
  }

  hojaR.getRange(2, 1, total, hojaR.getLastColumn()).clearContent();
  if (filas.length > 0) hojaR.getRange(2, 1, filas.length, 6).setValues(filas);
  Logger.log('Antes: ' + total + ' filas → Después: ' + filas.length + ' filas (últimos 95 días)');
}
function reconstruirResumenCarrera() {
  var stats = { inicio: new Date().toISOString() };
  var ss = getOrCreateSheet();
  try {
    var d3 = new Date(); d3.setDate(d3.getDate() - 3);
    var desde3 = Utilities.formatDate(d3, 'GMT-5', 'yyyy-MM-dd');
    var hasta = Utilities.formatDate(new Date(Date.now() + 86400000), 'GMT-5', 'yyyy-MM-dd');
    var s = sincronizarFacturasTramo(desde3, hasta);
    stats.nuevas = s.nuevas;
  } catch(e) { stats.e1 = e.message; }
  try { stats.filas = actualizarVentasUltimosDias(ss, 3); } catch(e) { stats.e2 = e.message; }
  try { stats.hoy = actualizarResumenCarreraHoyDesdeSiigo(); } catch(e) { stats.e3 = e.message; }
  stats.duracion_seg = Math.round((Date.now() - new Date(stats.inicio).getTime()) / 1000);
  registrarLog('carrera_refresh', 'usuario', JSON.stringify(stats).substring(0, 400));
  return stats;
}

function actualizarVentasUltimosDias(ss, dias) {
  var hojaR = ss.getSheetByName('VentasVendedorDia');
  var hojaF = ss.getSheetByName('SiigoFacturas');
  if (!hojaR || !hojaF || hojaF.getLastRow() <= 1) return 0;
  var corte = new Date(); corte.setDate(corte.getDate() - dias);
  var corteStr = Utilities.formatDate(corte, 'GMT-5', 'yyyy-MM-dd');
  var ahora = new Date();
  var total = hojaR.getLastRow() - 1;
  var filasKeep = [];
  if (total > 0) {
    var datos = hojaR.getRange(2, 1, total, 5).getValues();
    for (var i = 0; i < datos.length; i++) {
      var v = datos[i][0];
      var f = (v instanceof Date) ? Utilities.formatDate(v, 'GMT-5', 'yyyy-MM-dd') : String(v).substring(0, 10);
      if (f < corteStr) filasKeep.push([datos[i][0], datos[i][1], datos[i][2], datos[i][3], datos[i][4], ahora]);
    }
  }
  var rows = hojaF.getRange(2, 1, hojaF.getLastRow() - 1, 13).getValues();
  var grupos = {}, ids = {};
  for (var r = 0; r < rows.length; r++) {
    var fid = String(rows[r][0] || '');
    if (!fid || ids[fid]) continue; ids[fid] = true;
    var fecha = rows[r][2];
    var fechaStr = (fecha instanceof Date) ? Utilities.formatDate(fecha, 'GMT-5', 'yyyy-MM-dd') : String(fecha).substring(0, 10);
    if (!fechaStr || fechaStr < corteStr) continue;
    var vid = String(rows[r][6] || '');
    var tot = Number(rows[r][11] || 0);
    if (!esTipoDocumentoVentaValido(String(rows[r][3]||'')) || !esFacturaVentaValida(String(rows[r][12]||'')) || tot <= 0 || !vid) continue;
    var key = fechaStr + '|' + vid;
    if (!grupos[key]) grupos[key] = {fecha:fechaStr, vendedorId:vid, vendedor:String(rows[r][7]||''), total:0, facturas:0};
    grupos[key].total += tot; grupos[key].facturas++;
  }
  var filasNew = [];
  for (var k in grupos) filasNew.push([grupos[k].fecha, grupos[k].vendedorId, grupos[k].vendedor, Math.round(grupos[k].total), grupos[k].facturas, ahora]);
  hojaR.clearContents();
  hojaR.getRange(1,1,1,6).setValues([['Fecha','VendedorId','Vendedor','Total','Facturas','Actualizado']]);
  var todas = filasKeep.concat(filasNew).sort(function(a,b){return String(a[0]).localeCompare(String(b[0]));});
  if (todas.length > 0) hojaR.getRange(2,1,todas.length,6).setValues(todas);
  return filasNew.length;
}
// ============================================================
// FUNCIONES EXPUESTAS PARA google.script.run
// ============================================================
function gsLogin(username, password) {
  return login(username, password);
}

function gsPost(payloadJSON) {
  try {
    var body = JSON.parse(payloadJSON);
    var action = body.action;
    
    // Acciones sin token
    if (action === 'login') return JSON.stringify(login(body.username, body.password));
    if (action === 'cambiar_password_propia') return JSON.stringify(cambiarPasswordPropia(body.token, body.passwordActual, body.passwordNueva));
    if (action === 'logout') return JSON.stringify(logout(body.token));
    
    // Acciones con token
    var user = validarToken(body.token);
    if (!user) return JSON.stringify({error: 'Sesion invalida, vuelve a iniciar sesion', requireLogin: true});
    
    // Reusar doPost simulando el objeto e
    var fakeE = { postData: { contents: payloadJSON } };
    var result = doPost(fakeE);
    return result.getContent();
  } catch(err) {
    return JSON.stringify({error: err.toString()});
  }
}
// ============================================================
// COTIZACIONES PENDIENTES (no facturadas)
// Devuelve todas las cotizaciones cuyo estado NO sea "facturado",
// "anulado", "cancelado" ni similar. Útil para la vista pipeline
// del frontend que muestra oportunidades sin convertir.
// ============================================================
function listarCotizacionesPendientes() {
  var ss = getOrCreateSheet();
  var hojaC = ss.getSheetByName('SiigoCotizaciones');
  if (!hojaC || hojaC.getLastRow() < 2) {
    return { cotizaciones: [], resumen: { total: 0, valorTotal: 0 } };
  }

  // Mapa NIT → nombre del cliente
  var hojaClientes = ss.getSheetByName('SiigoClientes');
  var nombrePorIdent = {};
  if (hojaClientes && hojaClientes.getLastRow() > 1) {
    var cData = hojaClientes.getDataRange().getValues();
    for (var c = 1; c < cData.length; c++) {
      var cIdent = normalizarIdentificacion(cData[c][1] || '');
      if (cIdent) nombrePorIdent[cIdent] = String(cData[c][2] || '');
    }
  }

  // SiigoCotizaciones: IdSiigo(0), Numero(1), Fecha(2), ClienteId(3),
  //   ClienteIdentificacion(4), VendedorId(5), Vendedor(6), Subtotal(7),
  //   Descuento(8), Impuestos(9), Total(10), Estado(11), PublicUrl(12), Actualizado(13)
  var data = hojaC.getDataRange().getValues();
  var hoy = new Date();
  var cotizaciones = [];
  var totalValor = 0;
  // Estados que indican la cotización ya se convirtió o fue cancelada → excluir
  var EXCLUIR = ['factur', 'invoic', 'anul', 'cancel', 'void', 'elimin', 'rechaz'];

  for (var i = 1; i < data.length; i++) {
    var id = String(data[i][0] || '').trim();
    if (!id) continue;
    var estadoRaw = String(data[i][11] || '').toLowerCase();
    var excluido = false;
    for (var e = 0; e < EXCLUIR.length; e++) {
      if (estadoRaw.indexOf(EXCLUIR[e]) !== -1) { excluido = true; break; }
    }
    if (excluido) continue;

    var ident = normalizarIdentificacion(data[i][4] || '');
    var fecha = data[i][2] ? formatearFecha(data[i][2]) : '';
    var total = Number(data[i][10] || 0);
    var diasDesde = 0;
    if (fecha) {
      try {
        var fObj = new Date(fecha.substring(0,10));
        if (!isNaN(fObj.getTime())) diasDesde = Math.floor((hoy - fObj) / 86400000);
      } catch(ex) {}
    }

    totalValor += total;
    cotizaciones.push({
      id: id,
      numero: String(data[i][1] || ''),
      fecha: fecha,
      clienteId: String(data[i][3] || ''),
      clienteIdentificacion: ident,
      clienteNombre: nombrePorIdent[ident] || 'Sin nombre',
      vendedor: String(data[i][6] || ''),
      total: total,
      estado: String(data[i][11] || ''),
      publicUrl: String(data[i][12] || ''),
      diasDesde: diasDesde,
    });
  }

  cotizaciones.sort(function(a, b) {
    return (b.fecha || '').localeCompare(a.fecha || '');
  });

  return {
    cotizaciones: cotizaciones,
    resumen: {
      total: cotizaciones.length,
      valorTotal: Math.round(totalValor),
    }
  };
}

// ============================================================
// CAPTURA RÁPIDA (prospectos del vendedor externo)
// ============================================================
function guardarCapturaRapida(user, captura) {
  if (!captura || !captura.nombre) return { error: 'Falta nombre' };
  var ss = getOrCreateSheet();
  var hoja = ss.getSheetByName('CapturaRapida');
  if (!hoja) {
    hoja = ss.insertSheet('CapturaRapida');
    hoja.appendRow(['ID','Nombre','Empresa','Telefono','Documento','Direccion','Tipo','Seguimiento','Observaciones','Vendedor','VendedorNombre','Fecha','Estado']);
    hoja.getRange(1,1,1,13).setFontWeight('bold').setBackground('#E67E22').setFontColor('white');
  }
  // El vendedor por defecto es quien está logueado, pero se puede asignar la captura
  // a otro asesor (ej. cuando alguien captura en nombre de otra persona).
  var vendedorUsername = String((captura.vendedor || user.username || ''));
  var vendedorNombre = String((captura.vendedorNombre || user.nombre || ''));
  var id = String(captura.id || 'cap_' + Date.now());
  hoja.appendRow([
    id,
    String(captura.nombre || ''),
    String(captura.empresa || ''),
    String(captura.telefono || ''),
    String(captura.documento || ''),
    String(captura.direccion || ''),
    String(captura.tipo || ''),
    String(captura.seguimiento || ''),
    String(captura.observaciones || '').substring(0, 2000),
    vendedorUsername,
    vendedorNombre,
    new Date(),
    String(captura.estado || 'visitado')
  ]);
  registrarLog('captura_rapida', user.username, captura.nombre);

  // Si vino fecha de recordatorio, crear tambien el recordatorio para que salga en la agenda
  var recordatorioCreado = null;
  if (captura.recordatorioFecha) {
    var hojaRec = ss.getSheetByName('Recordatorios');
    if (hojaRec) {
      var recId = 'rec_' + Date.now();
      var descripcion = captura.recordatorioNota || ('Seguimiento prospecto: ' + captura.nombre);
      var creado = new Date().toISOString();
      hojaRec.appendRow([recId, id, captura.recordatorioFecha, captura.recordatorioHora || '09:00', descripcion, vendedorUsername, false, creado, '']);
      recordatorioCreado = {
        id: recId,
        clienteId: id,
        fecha: captura.recordatorioFecha,
        hora: captura.recordatorioHora || '09:00',
        descripcion: descripcion,
        vendedor: vendedorUsername,
        completado: false,
        creado: creado,
        accion: ''
      };
    }
  }
  return { status: 'ok', id: id, recordatorio: recordatorioCreado };
}

function listarCapturas(user) {
  var ss = getOrCreateSheet();
  var hoja = ss.getSheetByName('CapturaRapida');
  if (!hoja || hoja.getLastRow() <= 1) return { capturas: [] };
  var data = hoja.getDataRange().getValues();
  var lista = [];
  for (var i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    lista.push({
      id: String(data[i][0]),
      nombre: String(data[i][1] || ''),
      empresa: String(data[i][2] || ''),
      telefono: String(data[i][3] || ''),
      documento: String(data[i][4] || ''),
      direccion: String(data[i][5] || ''),
      tipo: String(data[i][6] || 'prospecto'),
      seguimiento: String(data[i][7] || ''),
      observaciones: String(data[i][8] || ''),
      vendedor: String(data[i][9] || ''),
      vendedorNombre: String(data[i][10] || ''),
      fecha: data[i][11] ? new Date(data[i][11]).toISOString() : '',
      estado: String(data[i][12] || 'prospecto'),
    });
  }
  if (!tienePermiso(user, 'ver_todos_clientes')) {
    lista = lista.filter(function(c) {
      return String(c.vendedor).toLowerCase() === String(user.username).toLowerCase();
    });
  }
  return { capturas: lista.reverse() };
}


// ============================================================
// PROSPECTOS (CapturaRapida): eliminar / editar / reasignar
// ============================================================

// Devuelve true si el usuario puede modificar (editar/eliminar) esta captura.
function _puedeModificarCaptura(user, vendedorDeLaCaptura) {
  if (tienePermiso(user, 'ver_todos_clientes')) return true;
  return String(vendedorDeLaCaptura || '').toLowerCase() === String(user.username || '').toLowerCase();
}

// Borra todas las filas de una hoja cuyo valor en la columna indicada (0-indexado)
// coincide exactamente con clienteId. Recorre de abajo hacia arriba para que al borrar
// una fila no se corra el indice de las filas que todavia faltan por revisar.
function _borrarFilasPorClienteId(hoja, columnaClienteId, clienteId) {
  if (!hoja) return 0;
  var ultimaFila = hoja.getLastRow();
  if (ultimaFila < 2) return 0;
  var data = hoja.getDataRange().getValues();
  var borradas = 0;
  for (var i = data.length - 1; i >= 1; i--) {
    if (String(data[i][columnaClienteId] || '') === String(clienteId)) {
      hoja.deleteRow(i + 1);
      borradas++;
    }
  }
  return borradas;
}

function eliminarCaptura(user, id) {
  if (!id) return { error: 'Falta id' };
  var ss = getOrCreateSheet();
  var hoja = ss.getSheetByName('CapturaRapida');
  if (!hoja) return { error: 'No existe la hoja CapturaRapida' };
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    var data = hoja.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(id)) {
        var vendedorActual = String(data[i][9] || '');
        if (!_puedeModificarCaptura(user, vendedorActual)) {
          return { error: 'Sin permiso para eliminar este prospecto' };
        }
        var nombre = String(data[i][1] || '');
        hoja.deleteRow(i + 1);
        // El usuario pidio que al eliminar un prospecto se borre TODO lo relacionado
        // con ese cliente (recordatorios, notas, llamadas y asignacion de vendedor),
        // para que no queden recordatorios huerfanos mostrando solo el ID en pantalla.
        _borrarFilasPorClienteId(ss.getSheetByName('Recordatorios'), 1, id);
        _borrarFilasPorClienteId(ss.getSheetByName('Notas'), 0, id);
        _borrarFilasPorClienteId(ss.getSheetByName('Llamadas'), 0, id);
        _borrarFilasPorClienteId(ss.getSheetByName('Asignaciones'), 0, id);
        registrarLog('eliminar_captura', user.username, nombre + ' (' + id + ')');
        return { status: 'ok', id: id };
      }
    }
    return { error: 'No se encontró el prospecto' };
  } finally {
    lock.releaseLock();
  }
}

function editarCaptura(user, id, cambios) {
  if (!id) return { error: 'Falta id' };
  cambios = cambios || {};
  var ss = getOrCreateSheet();
  var hoja = ss.getSheetByName('CapturaRapida');
  if (!hoja) return { error: 'No existe la hoja CapturaRapida' };
  var data = hoja.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) {
      var fila = i + 1;
      var vendedorActual = String(data[i][9] || '');
      if (!_puedeModificarCaptura(user, vendedorActual)) {
        return { error: 'Sin permiso para editar este prospecto' };
      }

      // Reasignar a otro vendedor (o quitarle el vendedor, dejandolo "sin asignar"):
      // requiere permiso adicional.
      var nuevoVendedor = cambios.vendedor !== undefined ? String(cambios.vendedor || '') : vendedorActual;
      if (cambios.vendedor !== undefined && nuevoVendedor.toLowerCase() !== vendedorActual.toLowerCase()) {
        if (!tienePermiso(user, 'reasignar_clientes')) {
          return { error: 'Sin permiso para reasignar a otro vendedor' };
        }
        hoja.getRange(fila, 10).setValue(nuevoVendedor);
        hoja.getRange(fila, 11).setValue(nuevoVendedor ? String(cambios.vendedorNombre || nuevoVendedor) : '');
      }

      if (cambios.nombre !== undefined)       hoja.getRange(fila, 2).setValue(String(cambios.nombre || ''));
      if (cambios.empresa !== undefined)      hoja.getRange(fila, 3).setValue(String(cambios.empresa || ''));
      if (cambios.telefono !== undefined)     hoja.getRange(fila, 4).setValue(String(cambios.telefono || ''));
      if (cambios.documento !== undefined)    hoja.getRange(fila, 5).setValue(String(cambios.documento || ''));
      if (cambios.direccion !== undefined)    hoja.getRange(fila, 6).setValue(String(cambios.direccion || ''));
      if (cambios.tipo !== undefined)         hoja.getRange(fila, 7).setValue(String(cambios.tipo || 'empresa'));
      if (cambios.seguimiento !== undefined)  hoja.getRange(fila, 8).setValue(String(cambios.seguimiento || ''));
      if (cambios.observaciones !== undefined) hoja.getRange(fila, 9).setValue(String(cambios.observaciones || '').substring(0, 2000));
      if (cambios.estado !== undefined)       hoja.getRange(fila, 13).setValue(String(cambios.estado || 'prospecto'));

      registrarLog('editar_captura', user.username, String(cambios.nombre || data[i][1] || '') + ' (' + id + ')');
      return { status: 'ok', id: id };
    }
  }
  return { error: 'No se encontró el prospecto' };
}

// Lista liviana de vendedores activos (para el selector de "reasignar a").
function listarVendedoresActivos() {
  var todos = listarUsuarios();
  var lista = [];
  for (var i = 0; i < todos.length; i++) {
    var u = todos[i];
    if (u.activo && u.rol !== 'solo_lectura') {
      lista.push({ username: u.username, nombre: u.nombre });
    }
  }
  return { vendedores: lista };
}

function obtenerProductosCliente(identificacion) {
  var vacio = { todosProductos: [], topProductos: [], comprasPorMes: [], topGrupos: [] };
  if (!identificacion) return vacio;
  var idLimpia = normalizarIdentificacion(identificacion);
  var ss = getOrCreateSheet();
  var datos = leerJSONPorClienteDesdeCache(ss, 'ProductosClienteCache', idLimpia);
  if (!datos) return vacio;
  return {
    todosProductos: datos.todosProductos || [],
    topProductos: datos.topProductos || [],
    comprasPorMes: datos.comprasPorMes || [],
    topGrupos: datos.topGrupos || [],
  };
}
