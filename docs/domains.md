# docs/domains.md — Los 20 dominios temáticos de Capibara

El dominio es el eje de clasificación central del producto.
Va como columna directa en layers.domain (no en JSON) porque es el filtro
más frecuente de la API: ?domain=geo,environment.

## Lista completa

| ID                  | Etiqueta             | Descripción                                        |
|---------------------|----------------------|----------------------------------------------------|
| geo                 | Geografía            | Límites administrativos, puntos de referencia      |
| normative           | Normativa            | Zonificación, ordenamiento territorial, legislación espacial |
| cadastre            | Catastro             | Parcelas, propiedades, valuaciones                 |
| social              | Social               | Servicios sociales, salud, educación               |
| demographics        | Demografía           | Censos, población, hogares                         |
| electoral           | Electoral            | Circuitos, mesas, resultados electorales           |
| environment         | Medio ambiente       | Áreas protegidas, contaminación, biodiversidad     |
| climate             | Clima                | Variables climáticas históricas                    |
| biological_risk     | Riesgo biológico     | Vectores de enfermedad, epidemias, plagas          |
| defense             | Defensa              | Infraestructura militar, zonas restringidas        |
| security            | Seguridad            | Comisarías, cámaras, incidentes                    |
| infrastructure      | Infraestructura      | Redes de agua, gas, comunicaciones                 |
| transport           | Transporte           | Vialidad, transporte público, puertos, aeropuertos |
| energy              | Energía              | Generación, distribución, subestaciones            |
| fire_risk           | Riesgo de incendio   | Combustibilidad, historial de incendios            |
| geodynamic_risk     | Riesgo geodinámico   | Sismicidad, vulcanismo, remoción en masa           |
| water_risk          | Riesgo hídrico       | Inundabilidad, cuencas, zonas de desborde          |
| weather_risk        | Riesgo meteorológico | Granizo, viento, heladas, alertas SMN              |
| technological_risk  | Riesgo tecnológico   | Industrias peligrosas, rutas de materiales peligrosos |
| monitoring          | Monitoreo            | Estaciones de medición, sensores IoT, tiempo real  |

## Convenciones

- biological_risk es independiente de environment — tiene sus propias fuentes
  (epidemiológicas, veterinarias) distintas de las ambientales.
- monitoring cubre capas de tiempo real con cualquier tipo de dato.
- catalog NO es un dominio — es una familia de endpoints del sistema.

## Uso en el API

Filtrar por uno:    ?domain=geo
Filtrar por varios: ?domain=geo,environment,climate
Sin filtro:         devuelve todo lo que cubre el punto
