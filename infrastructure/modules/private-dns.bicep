// Private DNS Zones module
// Creates Private DNS Zones for all Private Endpoints and links them to the VNet
// DNS zones enable the App Service to resolve private endpoint FQDNs to private IPs

@description('Resource ID of the Virtual Network to link DNS zones to')
param vnetId string

// ── Key Vault ────────────────────────────────────────────────────────────────
resource kvDnsZone 'Microsoft.Network/privateDnsZones@2020-06-01' = {
  name: 'privatelink.vaultcore.azure.net'
  location: 'global'

  resource kvVnetLink 'virtualNetworkLinks' = {
    name: 'kv-vnet-link'
    location: 'global'
    properties: {
      virtualNetwork: {
        id: vnetId
      }
      registrationEnabled: false
    }
  }
}

// ── Azure OpenAI ─────────────────────────────────────────────────────────────
resource openAiDnsZone 'Microsoft.Network/privateDnsZones@2020-06-01' = {
  name: 'privatelink.openai.azure.com'
  location: 'global'

  resource openAiVnetLink 'virtualNetworkLinks' = {
    name: 'openai-vnet-link'
    location: 'global'
    properties: {
      virtualNetwork: {
        id: vnetId
      }
      registrationEnabled: false
    }
  }
}

// ── Cognitive Services (Speech, Document Intelligence) ────────────────────────
resource cogServicesDnsZone 'Microsoft.Network/privateDnsZones@2020-06-01' = {
  name: 'privatelink.cognitiveservices.azure.com'
  location: 'global'

  resource cogServicesVnetLink 'virtualNetworkLinks' = {
    name: 'cogservices-vnet-link'
    location: 'global'
    properties: {
      virtualNetwork: {
        id: vnetId
      }
      registrationEnabled: false
    }
  }
}

// ── PostgreSQL Flexible Server ────────────────────────────────────────────────
resource postgresDnsZone 'Microsoft.Network/privateDnsZones@2020-06-01' = {
  name: 'privatelink.postgres.database.azure.com'
  location: 'global'

  resource postgresVnetLink 'virtualNetworkLinks' = {
    name: 'postgres-vnet-link'
    location: 'global'
    properties: {
      virtualNetwork: {
        id: vnetId
      }
      registrationEnabled: false
    }
  }
}

@description('Key Vault DNS Zone resource ID')
output kvDnsZoneId string = kvDnsZone.id

@description('Azure OpenAI DNS Zone resource ID')
output openAiDnsZoneId string = openAiDnsZone.id

@description('Cognitive Services DNS Zone resource ID')
output cogServicesDnsZoneId string = cogServicesDnsZone.id

@description('PostgreSQL DNS Zone resource ID')
output postgresDnsZoneId string = postgresDnsZone.id
