# docker-project.md --- Full Multi-Service Deployment

## 🐳 Container Topology

``` txt
docker-compose.yml
services:
  web-dashboard
  api-gateway
  simulation-engine
  ml-inference
  ml-retrain-scheduler
  kafka
  redis
  postgres
  neo4j
  model-registry
  nginx
```

## Services

### web-dashboard

-   React + Vite served by Nginx
-   exposes `3000`

### api-gateway

-   FastAPI
-   REST + WebSocket
-   routes scoring, graph, audit, cases

### simulation-engine

-   generates N accounts + N transactions
-   pushes stream to Kafka
-   updates graph events

### ml-inference

-   XGBoost + GraphSAGE scoring
-   SHAP generation
-   model version endpoint

### ml-retrain-scheduler

-   **retrain every 7 days**
-   APScheduler / Celery beat
-   pulls latest labels
-   validates metrics
-   promotes challenger model

### Databases

-   PostgreSQL → transactions + cases + audit
-   Neo4j → fraud graph + mule rings
-   Redis → feature cache
-   Kafka → event stream
-   local `/models` volume → saved champions

```{=html}
<!-- -->
```

    ## Retrain Schedule
    ```txt
    RRULE:FREQ=DAILY;INTERVAL=7

## Model Lifecycle

day 0 champion → day 7 retrain → shadow compare → auto report → manual
promote
