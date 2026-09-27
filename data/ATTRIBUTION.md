# Data sources and licences

The open-data pack is derived from the sources below. The generated layers are clearly labelled `synthetic`, and they carry no information about real people or real land records. Owner names come from a list of common given names and family names.

| Source | Used for | Licence / terms |
|---|---|---|
| © OpenStreetMap contributors | Streets (city blocks), mandal boundaries, locality names, power lines, pipelines, drains | Open Database License (ODbL) 1.0: https://www.openstreetmap.org/copyright |
| Microsoft Global ML Building Footprints | Building outlines (default) | Open Data Commons ODbL: https://github.com/microsoft/GlobalMLBuildingFootprints |
| Overture Maps Foundation, buildings theme (optional, `NAKSHA_BUILDINGS=overture`) | Building outlines (Google Open Buildings + Microsoft + OSM) | ODbL / CDLA-Permissive-2.0 by source: https://docs.overturemaps.org/attribution |
| Copernicus DEM GLO-30 | Terrain of the synthetic DSM/DTM | © DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018, provided under COPERNICUS by the European Union and ESA; all rights reserved. Free use with attribution |
| Survey of India / Office of the Registrar General of India, harmonised village boundaries of Andhra Pradesh (`data/soi/ANDHRA_PRADESH/`, Git LFS) | Official GVMC outline (LGD 802947) as the ward study area; village / mandal / district LGD codes (`villages` table) | Government of India data, included as received. Check the terms under which it was supplied before making this repository or derived files public |

**Attribution to display when the data is shown or shared:**

> Building footprints © Microsoft (ODbL); map data © OpenStreetMap contributors (ODbL); terrain © Copernicus DEM (ESA/EU). Parcels, land records, ward zones, control points and field observations are synthetic.
