# Parche: sacar `todosProductos` de la lista inicial de clientes

**Por qué:** `procesarClientesSiigo()` guardaba, por cada uno de los ~10.600 clientes,
la lista COMPLETA de productos distintos que ha comprado (`todosProductos`, sin límite).
Eso hizo que el cache (`DatosCache`, leído por `cargar_clientes`) creciera a **32 MB**.
El navegador tiene 60 segundos de espera — con esa demora, sobre todo en una conexión
lenta o la primera vez que se abre la app en un dispositivo, la carga de clientes falla
y la pantalla se queda en "conexión lenta" con 0 clientes. No es ningún bloqueo de
seguridad ni virus.

**Qué hace el parche:** mueve `todosProductos` a un cache aparte, por cliente, que se
trae solo cuando alguien abre la ficha de compras de ESE cliente en particular — igual
al patrón que ya usan `FacturasClienteCache`, `CotizacionesClienteCache` y
`CarteraClienteCache`. La lista principal (`DatosCache`) queda mucho más liviana.

El frontend (`app/index.html` de este repo) ya está corregido y subido a GitHub — trae
ese detalle bajo demanda y lo guarda en el mismo cliente, así que el resto del código
que ya lee `c.todosProductos` sigue funcionando igual, sin más cambios.

**Falta aplicar esto en el backend** (`Código.gs`, proyecto "Gestión de Clientes - Full
Company" en Apps Script) — 3 ediciones puntuales, con buscar-y-reemplazar:

## 1. Declarar el mapa nuevo

Busca esta línea (dentro de `procesarClientesSiigo`, antes del `for (var ci = 1; ...)`):

```js
  var clientes = [];
```

Reemplázala por:

```js
  var clientes = [];
  var mapaProductosCliente = {};
```

## 2. Sacar `todosProductos` del objeto de cada cliente

Busca este bloque (dentro del mismo `for`, justo antes de `clientes.push({`):

```js
    var topProductos = listaProd.slice().sort(function(a,b){ return b.valor - a.valor; }).slice(0, 10);
    var todosProductos = listaProd.sort(function(a,b){ return (b.ultimoMes||'').localeCompare(a.ultimoMes||''); });
```

Justo después de esas dos líneas, agrega:

```js
    mapaProductosCliente[ident] = todosProductos;
```

Luego, dentro del `clientes.push({ ... })`, busca esta línea:

```js
      todosProductos: todosProductos,
```

Y bórrala (solo esa línea; deja `topProductos:`, `topGrupos:` y `comprasPorMes:` tal cual
están).

## 3. Guardar el cache nuevo

Busca este bloque (después de guardar `DatosCache`, antes de
`props.setProperty('clientes_cache_fecha'...`):

```js
  if (filas.length > 0) hojaCache.getRange(1, 1, filas.length, 1).setValues(filas);
```

Justo después de esa línea, agrega:

```js

  // Guardar el detalle de productos por cliente aparte (evita que la lista pese 30+MB)
  var hojaProd = ss.getSheetByName('ProductosClienteCache');
  if (!hojaProd) {
    hojaProd = ss.insertSheet('ProductosClienteCache');
    hojaProd.getRange(1, 1, 1, 4).setValues([['Identificacion', 'Chunk', 'JSON', 'Fecha']]);
  }
  guardarJSONPorClienteEnChunks(ss, 'ProductosClienteCache', mapaProductosCliente, null);
```

## 4. Agregar la función y la ruta nueva

En cualquier parte del archivo (por ejemplo, justo debajo de `function obtenerFacturasCliente`),
pega esta función nueva:

```js
function obtenerProductosCliente(identificacion) {
  if (!identificacion) return { todosProductos: [] };
  var idLimpia = normalizarIdentificacion(identificacion);
  var ss = getOrCreateSheet();
  var todosProductos = leerJSONPorClienteDesdeCache(ss, 'ProductosClienteCache', idLimpia);
  return { todosProductos: todosProductos || [] };
}
```

Y en el router de acciones (busca `if (action === 'cargar_clientes')`), agrega justo
después:

```js
    if (action === 'productos_cliente_obtener') {
      return jsonResponse(obtenerProductosCliente(body.identificacion));
    }
```

## 5. Guardar, desplegar y reconstruir el cache

1. Guarda el archivo (Ctrl+S).
2. Implementar → Administrar implementaciones → lápiz (editar) → Versión: "Nueva
   versión" → Implementar. (No crear una implementación nueva — así la URL no cambia).
3. En el editor, selecciona la función `procesarClientesSiigo` en el menú de arriba y
   dale "Ejecutar" una vez, para reconstruir `DatosCache` ya sin el peso extra.
4. Revisa el resultado en "Registro de ejecución": debe decir un `tamanoKB` bastante
   más chico que antes. Si quieres saber el número exacto de antes, este mismo log lo
   muestra cada vez que se corre.
