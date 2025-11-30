# Tale DB Deployment Guide

This guide covers deploying Tale DB in various environments, from local development to production Kubernetes clusters.

## Table of Contents

- [Local Development](#local-development)
- [Docker Compose Deployment](#docker-compose-deployment)
- [Kubernetes Deployment](#kubernetes-deployment)
- [Cloud Deployments](#cloud-deployments)
- [Security Hardening](#security-hardening)
- [Monitoring and Alerting](#monitoring-and-alerting)
- [Backup and Recovery](#backup-and-recovery)
- [Performance Tuning](#performance-tuning)

## Local Development

### Quick Start

```bash
# Clone the repository
git clone https://github.com/your-org/tale.git
cd tale

# Configure environment
cp db/.env.example .env
nano .env  # Change DB_PASSWORD

# Start Tale DB
docker compose up -d db

# Verify it's running
docker compose ps db
docker compose logs -f db
```

### Development Configuration

For local development, use minimal resource allocation:

```bash
# .env for development
DB_NAME=tale_dev
DB_USER=tale_dev
DB_PASSWORD=dev_password_123

# Memory settings for development (2GB RAM available)
DB_SHARED_BUFFERS=128MB
DB_EFFECTIVE_CACHE_SIZE=512MB
DB_WORK_MEM=4MB

# Enable verbose logging
DB_LOG_STATEMENT=all
DB_LOG_MIN_DURATION_STATEMENT=0
```

## Docker Compose Deployment

### Production Docker Compose

For production deployments using Docker Compose:

```yaml
# docker-compose.prod.yml
version: '3.8'

services:
  db:
    image: ghcr.io/your-org/tale-db:latest
    container_name: tale-db
    restart: always
    ports:
      - '127.0.0.1:5432:5432' # Bind to localhost only
    environment:
      DB_NAME: ${DB_NAME}
      DB_USER: ${DB_USER}
      DB_PASSWORD: ${DB_PASSWORD}
      DB_MAX_CONNECTIONS: 200
      DB_SHARED_BUFFERS: 2GB
      DB_EFFECTIVE_CACHE_SIZE: 6GB
      DB_MAINTENANCE_WORK_MEM: 512MB
      DB_WORK_MEM: 16MB
      DB_LOG_STATEMENT: none
      DB_LOG_MIN_DURATION_STATEMENT: 1000
    volumes:
      - db-data:/var/lib/postgresql/data
      - db-backup:/var/lib/postgresql/backup
      - /etc/localtime:/etc/localtime:ro
    networks:
      - internal
    deploy:
      resources:
        limits:
          cpus: '4'
          memory: 8G
        reservations:
          cpus: '2'
          memory: 4G

volumes:
  db-data:
    driver: local
  db-backup:
    driver: local

networks:
  internal:
    driver: bridge
```

### Deploy

```bash
# Set environment variables
export DB_PASSWORD=$(openssl rand -base64 32)

# Start services
docker compose -f docker-compose.prod.yml up -d

# Check health
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml exec tale-db pg_isready
```

## Kubernetes Deployment

### Namespace

```yaml
# namespace.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: tale
```

### Secret

```yaml
# secret.yaml
apiVersion: v1
kind: Secret
metadata:
  name: db-credentials
  namespace: tale
type: Opaque
stringData:
  DB_NAME: tale
  DB_USER: tale
  DB_PASSWORD: <generate-secure-password>
```

### PersistentVolumeClaim

```yaml
# pvc.yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: db-data
  namespace: tale
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 100Gi
  storageClassName: fast-ssd # Adjust based on your cluster
```

### Deployment

```yaml
# deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: db
  namespace: tale
spec:
  replicas: 1
  selector:
    matchLabels:
      app: db
  template:
    metadata:
      labels:
        app: db
    spec:
      containers:
        - name: db
          image: ghcr.io/your-org/tale-db:latest
          ports:
            - containerPort: 5432
              name: postgresql
          env:
            - name: DB_NAME
              valueFrom:
                secretKeyRef:
                  name: db-credentials
                  key: DB_NAME
            - name: DB_USER
              valueFrom:
                secretKeyRef:
                  name: db-credentials
                  key: DB_USER
            - name: DB_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: db-credentials
                  key: DB_PASSWORD
            - name: DB_MAX_CONNECTIONS
              value: '200'
            - name: DB_SHARED_BUFFERS
              value: '2GB'
            - name: DB_EFFECTIVE_CACHE_SIZE
              value: '6GB'
          volumeMounts:
            - name: data
              mountPath: /var/lib/postgresql/data
          resources:
            requests:
              memory: '4Gi'
              cpu: '2'
            limits:
              memory: '8Gi'
              cpu: '4'
          livenessProbe:
            exec:
              command:
                - pg_isready
                - -U
                - tale
                - -d
                - tale
            initialDelaySeconds: 60
            periodSeconds: 30
          readinessProbe:
            exec:
              command:
                - pg_isready
                - -U
                - tale
                - -d
                - tale
            initialDelaySeconds: 30
            periodSeconds: 10
      volumes:
        - name: data
          persistentVolumeClaim:
            claimName: db-data
```

### Service

```yaml
# service.yaml
apiVersion: v1
kind: Service
metadata:
  name: db
  namespace: tale
spec:
  type: ClusterIP
  ports:
    - port: 5432
      targetPort: 5432
      protocol: TCP
      name: postgresql
  selector:
    app: db
```

### Deploy to Kubernetes

```bash
# Create namespace
kubectl apply -f namespace.yaml

# Create secret (generate password first)
export DB_PASSWORD=$(openssl rand -base64 32)
kubectl create secret generic db-credentials \
  --from-literal=DB_NAME=tale \
  --from-literal=DB_USER=tale \
  --from-literal=DB_PASSWORD=$DB_PASSWORD \
  -n tale

# Create PVC
kubectl apply -f pvc.yaml

# Deploy database
kubectl apply -f deployment.yaml
kubectl apply -f service.yaml

# Check status
kubectl get pods -n tale
kubectl logs -f deployment/db -n tale
```

## Cloud Deployments

### AWS (ECS/Fargate)

Use the GitHub Container Registry image with ECS task definitions:

```json
{
  "family": "tale-db",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "2048",
  "memory": "8192",
  "containerDefinitions": [
    {
      "name": "tale-db",
      "image": "ghcr.io/your-org/tale-db:latest",
      "portMappings": [
        {
          "containerPort": 5432,
          "protocol": "tcp"
        }
      ],
      "environment": [
        { "name": "DB_MAX_CONNECTIONS", "value": "200" },
        { "name": "DB_SHARED_BUFFERS", "value": "2GB" }
      ],
      "secrets": [
        {
          "name": "DB_PASSWORD",
          "valueFrom": "arn:aws:secretsmanager:region:account:secret:tale-db-password"
        }
      ],
      "mountPoints": [
        {
          "sourceVolume": "tale-db-data",
          "containerPath": "/var/lib/postgresql/data"
        }
      ]
    }
  ],
  "volumes": [
    {
      "name": "tale-db-data",
      "efsVolumeConfiguration": {
        "fileSystemId": "fs-xxxxx"
      }
    }
  ]
}
```

### Google Cloud (Cloud Run)

```bash
# Build and push to GCR
docker tag tale-db:latest gcr.io/your-project/tale-db:latest
docker push gcr.io/your-project/tale-db:latest

# Deploy to Cloud Run
gcloud run deploy tale-db \
  --image gcr.io/your-project/tale-db:latest \
  --platform managed \
  --region us-central1 \
  --memory 8Gi \
  --cpu 4 \
  --set-env-vars DB_MAX_CONNECTIONS=200 \
  --set-secrets DB_PASSWORD=tale-db-password:latest
```

### Azure (Container Instances)

```bash
# Create resource group
az group create --name tale-rg --location eastus

# Create container
az container create \
  --resource-group tale-rg \
  --name tale-db \
  --image ghcr.io/your-org/tale-db:latest \
  --cpu 4 \
  --memory 8 \
  --ports 5432 \
  --environment-variables \
    DB_MAX_CONNECTIONS=200 \
    DB_SHARED_BUFFERS=2GB \
  --secure-environment-variables \
    DB_PASSWORD=$DB_PASSWORD
```

## Security Hardening

### 1. Network Security

```bash
# Bind to localhost only
ports:
  - "127.0.0.1:5432:5432"

# Use internal networks
networks:
  - tale-internal
```

### 2. SSL/TLS Configuration

Create SSL certificates and mount them:

```yaml
volumes:
  - ./certs/server.crt:/var/lib/postgresql/server.crt:ro
  - ./certs/server.key:/var/lib/postgresql/server.key:ro
```

### 3. Strong Passwords

```bash
# Generate secure password
openssl rand -base64 32

# Use secrets management
# - Kubernetes Secrets
# - AWS Secrets Manager
# - Azure Key Vault
# - HashiCorp Vault
```

### 4. Firewall Rules

```bash
# Allow only specific IPs
iptables -A INPUT -p tcp --dport 5432 -s 10.0.0.0/8 -j ACCEPT
iptables -A INPUT -p tcp --dport 5432 -j DROP
```

## Monitoring and Alerting

### Prometheus Exporter

```yaml
# Add postgres_exporter sidecar
- name: postgres-exporter
  image: prometheuscommunity/postgres-exporter
  ports:
    - containerPort: 9187
  env:
    - name: DATA_SOURCE_NAME
      value: 'postgresql://tale:password@localhost:5432/tale?sslmode=disable'
```

### Grafana Dashboard

Import dashboard ID: 9628 (PostgreSQL Database)

### CloudWatch (AWS)

```bash
# Enable CloudWatch logs
awslogs-group: /ecs/tale-db
awslogs-region: us-east-1
awslogs-stream-prefix: tale-db
```

## Backup and Recovery

### Automated Backups

```bash
# Cron job for daily backups
0 2 * * * docker exec tale-db pg_dump -U tale tale | gzip > /backups/tale-$(date +\%Y\%m\%d).sql.gz

# Retention policy (keep 30 days)
find /backups -name "tale-*.sql.gz" -mtime +30 -delete
```

### Point-in-Time Recovery

Enable WAL archiving:

```bash
# Add to postgresql.conf
wal_level = replica
archive_mode = on
archive_command = 'cp %p /var/lib/postgresql/wal_archive/%f'
```

## Performance Tuning

### Connection Pooling

Use PgBouncer:

```yaml
services:
  pgbouncer:
    image: pgbouncer/pgbouncer
    environment:
      DATABASES_HOST: tale-db
      DATABASES_PORT: 5432
      DATABASES_USER: tale
      DATABASES_PASSWORD: ${DB_PASSWORD}
      DATABASES_DBNAME: tale
      PGBOUNCER_POOL_MODE: transaction
      PGBOUNCER_MAX_CLIENT_CONN: 1000
      PGBOUNCER_DEFAULT_POOL_SIZE: 25
```

### Query Optimization

```sql
-- Enable query statistics
CREATE EXTENSION pg_stat_statements;

-- Find slow queries
SELECT
  query,
  calls,
  total_time,
  mean_time,
  max_time
FROM pg_stat_statements
ORDER BY mean_time DESC
LIMIT 10;
```

### Index Optimization

```sql
-- Find missing indexes
SELECT
  schemaname,
  tablename,
  attname,
  n_distinct,
  correlation
FROM pg_stats
WHERE schemaname = 'tale'
ORDER BY n_distinct DESC;
```

## Troubleshooting

### Common Issues

1. **Out of Memory**

   - Reduce `shared_buffers`
   - Reduce `work_mem`
   - Add more RAM

2. **Too Many Connections**

   - Increase `max_connections`
   - Use connection pooling
   - Check for connection leaks

3. **Slow Queries**

   - Add indexes
   - Optimize queries
   - Increase `work_mem`

4. **Disk Space**
   - Enable autovacuum
   - Archive old data
   - Increase volume size

## Support

For issues or questions:

- Check [Tale DB README](../services/db/README.md)
- Review [TimescaleDB docs](https://docs.timescale.com/)
- Contact Tale support team
