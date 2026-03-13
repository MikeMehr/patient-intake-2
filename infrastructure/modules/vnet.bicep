// VNet module — creates Virtual Network with app-subnet and pe-subnet
// app-subnet: delegated to App Service VNet integration
// pe-subnet: for Private Endpoints (network policies disabled)

@description('Azure region for all resources')
param location string

@description('Name prefix for all resources')
param namePrefix string

@description('VNet address space (e.g. 10.0.0.0/16)')
param vnetAddressPrefix string = '10.0.0.0/16'

@description('App Service subnet address prefix (e.g. 10.0.0.0/24)')
param appSubnetPrefix string = '10.0.0.0/24'

@description('Private Endpoint subnet address prefix (e.g. 10.0.1.0/24)')
param peSubnetPrefix string = '10.0.1.0/24'

@description('NSG resource ID to attach to app-subnet')
param appSubnetNsgId string

resource vnet 'Microsoft.Network/virtualNetworks@2023-05-01' = {
  name: '${namePrefix}-vnet'
  location: location
  properties: {
    addressSpace: {
      addressPrefixes: [vnetAddressPrefix]
    }
    subnets: [
      {
        name: 'app-subnet'
        properties: {
          addressPrefix: appSubnetPrefix
          networkSecurityGroup: {
            id: appSubnetNsgId
          }
          delegations: [
            {
              name: 'app-service-delegation'
              properties: {
                serviceName: 'Microsoft.Web/serverFarms'
              }
            }
          ]
          serviceEndpoints: [
            { service: 'Microsoft.KeyVault' }
            { service: 'Microsoft.Sql' }
          ]
        }
      }
      {
        name: 'pe-subnet'
        properties: {
          addressPrefix: peSubnetPrefix
          // Must be disabled to attach private endpoints
          privateEndpointNetworkPolicies: 'Disabled'
          privateLinkServiceNetworkPolicies: 'Disabled'
        }
      }
    ]
  }
}

@description('Virtual Network resource ID')
output vnetId string = vnet.id

@description('Virtual Network name')
output vnetName string = vnet.name

@description('App subnet resource ID')
output appSubnetId string = vnet.properties.subnets[0].id

@description('Private Endpoint subnet resource ID')
output peSubnetId string = vnet.properties.subnets[1].id
