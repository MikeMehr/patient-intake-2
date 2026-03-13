// Health Assist AI — Azure Network Infrastructure
// Creates VNet, NSG, Private Endpoints, Private DNS Zones, and App Service VNet Integration
//
// IMPORTANT: Run with --what-if first to preview changes before applying.
// Disabling public network access on individual resources (OpenAI, DB) is a
// separate manual step done AFTER verifying Private Endpoint connectivity.
//
// Deploy:
//   az deployment group create \
//     --resource-group rg-health-assist-prod \
//     --template-file infrastructure/main.bicep \
//     --parameters infrastructure/parameters.prod.json

@description('Azure region for all resources')
param location string = 'eastus2'

@description('Name prefix used for all created resources (e.g. health-assist-prod)')
param namePrefix string = 'health-assist-prod'

@description('Name of the existing App Service')
param appServiceName string = 'healt-assist-ai-prod'

@description('Name of the existing Key Vault')
param keyVaultName string = 'health-assist-ai-prod-kv'

@description('Name of the existing Azure AI (Cognitive Services / OpenAI) account')
param aiResourceName string

@description('Resource group of the Azure AI resource (if different from deployment RG)')
param aiResourceGroup string = resourceGroup().name

@description('Name of the existing PostgreSQL Flexible Server')
param postgresServerName string

@description('Resource group of the PostgreSQL server (if different from deployment RG)')
param postgresResourceGroup string = resourceGroup().name

@description('VNet address space CIDR')
param vnetAddressPrefix string = '10.0.0.0/16'

@description('App Service subnet CIDR (must be /26 or larger for VNet integration)')
param appSubnetPrefix string = '10.0.0.0/24'

@description('Private Endpoint subnet CIDR')
param peSubnetPrefix string = '10.0.1.0/24'

// ── Reference existing resources ─────────────────────────────────────────────

resource keyVault 'Microsoft.KeyVault/vaults@2023-02-01' existing = {
  name: keyVaultName
}

resource aiResource 'Microsoft.CognitiveServices/accounts@2023-05-01' existing = {
  name: aiResourceName
  scope: resourceGroup(aiResourceGroup)
}

resource postgresServer 'Microsoft.DBforPostgreSQL/flexibleServers@2023-06-01-preview' existing = {
  name: postgresServerName
  scope: resourceGroup(postgresResourceGroup)
}

// ── NSG (created before VNet so ID is available for subnet) ──────────────────

module nsg 'modules/nsg.bicep' = {
  name: 'nsg-deploy'
  params: {
    location: location
    namePrefix: namePrefix
    peSubnetPrefix: peSubnetPrefix
  }
}

// ── Virtual Network ───────────────────────────────────────────────────────────

module vnet 'modules/vnet.bicep' = {
  name: 'vnet-deploy'
  params: {
    location: location
    namePrefix: namePrefix
    vnetAddressPrefix: vnetAddressPrefix
    appSubnetPrefix: appSubnetPrefix
    peSubnetPrefix: peSubnetPrefix
    appSubnetNsgId: nsg.outputs.nsgId
  }
}

// ── Private DNS Zones ─────────────────────────────────────────────────────────

module privateDns 'modules/private-dns.bicep' = {
  name: 'private-dns-deploy'
  params: {
    vnetId: vnet.outputs.vnetId
  }
}

// ── Private Endpoints ─────────────────────────────────────────────────────────

module privateEndpoints 'modules/private-endpoints.bicep' = {
  name: 'private-endpoints-deploy'
  params: {
    location: location
    namePrefix: namePrefix
    peSubnetId: vnet.outputs.peSubnetId
    keyVaultResourceId: keyVault.id
    aiResourceId: aiResource.id
    postgresResourceId: postgresServer.id
    keyVaultDnsZoneId: privateDns.outputs.kvDnsZoneId
    aiDnsZoneId: privateDns.outputs.openAiDnsZoneId
    cogServicesDnsZoneId: privateDns.outputs.cogServicesDnsZoneId
    postgresDnsZoneId: privateDns.outputs.postgresDnsZoneId
  }
}

// ── App Service VNet Integration ──────────────────────────────────────────────

module appServiceVnetIntegration 'modules/app-service-vnet-integration.bicep' = {
  name: 'app-service-vnet-integration-deploy'
  params: {
    appServiceName: appServiceName
    appSubnetId: vnet.outputs.appSubnetId
  }
}

// ── Outputs ───────────────────────────────────────────────────────────────────

@description('Virtual Network resource ID')
output vnetId string = vnet.outputs.vnetId

@description('App Service subnet resource ID')
output appSubnetId string = vnet.outputs.appSubnetId

@description('Private Endpoint subnet resource ID')
output peSubnetId string = vnet.outputs.peSubnetId

@description('Key Vault Private Endpoint resource ID')
output kvPeId string = privateEndpoints.outputs.kvPeId

@description('Azure AI Private Endpoint resource ID')
output aiPeId string = privateEndpoints.outputs.aiPeId

@description('PostgreSQL Private Endpoint resource ID')
output postgresPeId string = privateEndpoints.outputs.postgresPeId
