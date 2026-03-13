// Private Endpoints module
// Creates Private Endpoints for: Key Vault, Azure AI (OpenAI/Phi), PostgreSQL
// Each endpoint is placed in the pe-subnet and linked to its Private DNS zone

@description('Azure region for all resources')
param location string

@description('Name prefix for all resources')
param namePrefix string

@description('Resource ID of the Private Endpoint subnet')
param peSubnetId string

@description('Resource ID of the Key Vault')
param keyVaultResourceId string

@description('Resource ID of the Azure AI (Cognitive Services / OpenAI) account')
param aiResourceId string

@description('Resource ID of the PostgreSQL Flexible Server')
param postgresResourceId string

@description('Private DNS Zone ID for Key Vault (privatelink.vaultcore.azure.net)')
param keyVaultDnsZoneId string

@description('Private DNS Zone ID for Azure AI (privatelink.openai.azure.com)')
param aiDnsZoneId string

@description('Private DNS Zone ID for Cognitive Services (privatelink.cognitiveservices.azure.com)')
param cogServicesDnsZoneId string

@description('Private DNS Zone ID for PostgreSQL (privatelink.postgres.database.azure.com)')
param postgresDnsZoneId string

// ── Key Vault Private Endpoint ────────────────────────────────────────────────
resource kvPrivateEndpoint 'Microsoft.Network/privateEndpoints@2023-05-01' = {
  name: '${namePrefix}-kv-pe'
  location: location
  properties: {
    subnet: {
      id: peSubnetId
    }
    privateLinkServiceConnections: [
      {
        name: '${namePrefix}-kv-pe-connection'
        properties: {
          privateLinkServiceId: keyVaultResourceId
          groupIds: ['vault']
        }
      }
    ]
  }

  resource kvDnsGroup 'privateDnsZoneGroups' = {
    name: 'kv-dns-zone-group'
    properties: {
      privateDnsZoneConfigs: [
        {
          name: 'privatelink-vaultcore-azure-net'
          properties: {
            privateDnsZoneId: keyVaultDnsZoneId
          }
        }
      ]
    }
  }
}

// ── Azure AI (OpenAI / Phi) Private Endpoint ──────────────────────────────────
resource aiPrivateEndpoint 'Microsoft.Network/privateEndpoints@2023-05-01' = {
  name: '${namePrefix}-ai-pe'
  location: location
  properties: {
    subnet: {
      id: peSubnetId
    }
    privateLinkServiceConnections: [
      {
        name: '${namePrefix}-ai-pe-connection'
        properties: {
          privateLinkServiceId: aiResourceId
          groupIds: ['account']
        }
      }
    ]
  }

  resource aiDnsGroup 'privateDnsZoneGroups' = {
    name: 'ai-dns-zone-group'
    properties: {
      privateDnsZoneConfigs: [
        {
          name: 'privatelink-openai-azure-com'
          properties: {
            privateDnsZoneId: aiDnsZoneId
          }
        }
        {
          name: 'privatelink-cognitiveservices-azure-com'
          properties: {
            privateDnsZoneId: cogServicesDnsZoneId
          }
        }
      ]
    }
  }
}

// ── PostgreSQL Flexible Server Private Endpoint ───────────────────────────────
resource postgresPrivateEndpoint 'Microsoft.Network/privateEndpoints@2023-05-01' = {
  name: '${namePrefix}-postgres-pe'
  location: location
  properties: {
    subnet: {
      id: peSubnetId
    }
    privateLinkServiceConnections: [
      {
        name: '${namePrefix}-postgres-pe-connection'
        properties: {
          privateLinkServiceId: postgresResourceId
          groupIds: ['postgresqlServer']
        }
      }
    ]
  }

  resource postgresDnsGroup 'privateDnsZoneGroups' = {
    name: 'postgres-dns-zone-group'
    properties: {
      privateDnsZoneConfigs: [
        {
          name: 'privatelink-postgres-database-azure-com'
          properties: {
            privateDnsZoneId: postgresDnsZoneId
          }
        }
      ]
    }
  }
}

@description('Key Vault Private Endpoint resource ID')
output kvPeId string = kvPrivateEndpoint.id

@description('Azure AI Private Endpoint resource ID')
output aiPeId string = aiPrivateEndpoint.id

@description('PostgreSQL Private Endpoint resource ID')
output postgresPeId string = postgresPrivateEndpoint.id
