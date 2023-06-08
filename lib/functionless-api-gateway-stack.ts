import * as cdk from 'aws-cdk-lib';
import { RemovalPolicy } from 'aws-cdk-lib';
import { AuthorizationType, AwsIntegration, RestApi } from 'aws-cdk-lib/aws-apigateway';
import { AttributeType, BillingMode, Table } from 'aws-cdk-lib/aws-dynamodb';
import { Effect, PolicyDocument, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
// import * as sqs from 'aws-cdk-lib/aws-sqs';

const partitionKey = "id";

export class FunctionlessApiGatewayStack extends cdk.Stack {
  
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    const dynamoTable = new Table(this, "stockTable", {
      partitionKey: {
        name: partitionKey,
        type: AttributeType.STRING
      },
      billingMode: BillingMode.PAY_PER_REQUEST,
      tableName: "stock-count",
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const updateDdbRole = new Role(
      this,
      "UpdateDdbRole",
      {
        assumedBy: new ServicePrincipal("apigateway.amazonaws.com"),
        inlinePolicies: {
          allDdbReadWrite: new PolicyDocument({
            statements: [
              new PolicyStatement({
                effect: Effect.ALLOW,
                actions: ["dynamodb:UpdateItem", "dynamodb:GetItem"],
                resources: [
                  dynamoTable.tableArn
                ],
              }),
            ],
          }),
        },
      }
    );

    const api = new RestApi(this, "Gateway", {});
    const remove = api.root.addResource("remove");
    remove.addMethod("POST", new AwsIntegration({
      service: "dynamodb",
      action: "UpdateItem",
      integrationHttpMethod: "POST",
      options: {
        credentialsRole: updateDdbRole,
        requestTemplates: {
          "application/json": `
          #set($data = $util.escapeJavaScript($input.json('$')))
          #set($id = $data.id)
          {
            "tableName": "${dynamoTable.tableName}",
            "key": {
              "${partitionKey}": {
                "S": "$id"
              }
            },
            "updateExpression": "SET Quantity = Quantity - 1",
            "conditionExpression": "Quantity > 0"
          }`,
        }
      }
    }),
    {
      authorizationType: AuthorizationType.IAM,
    })

    const add = api.root.addResource("add");
    add.addMethod("POST", new AwsIntegration({
      service: "dynamodb",
      action: "UpdateItem",
      integrationHttpMethod: "POST",
      options: {
        credentialsRole: updateDdbRole,
        requestTemplates: {
          "application/json": `
          #set($id = $input.path("$").id)
          {
            "TableName": "${dynamoTable.tableName}",
            "Key": {
              "${partitionKey}": {
                "S": "$id"
              }
            },
            "UpdateExpression": "SET Quantity = Quantity + :incr",
            "ExpressionAttributeValues": {
              ":incr": {
                "N": "1"
              }
            },
            "ReturnValues": "ALL_NEW"
          }`,
        },
        integrationResponses: [
          {
            statusCode: "200",
            responseTemplates: {
              "application/json": `
                #set($inputRoot = $input.path('$'))
                {
                  "currentStock": $inputRoot.Attributes.Quantity.N
                }
              `,
            },
          },
          {
            statusCode: "400",
            responseTemplates: {
              "application/json": `
                #set($inputRoot = $input.path('$'))
                {
                  "clientError": $inputRoot
                }
              `,
            },
          },
          {
            statusCode: "500",
            responseTemplates: {
              "application/json": `
                #set($inputRoot = $input.path('$'))
                {
                  "serverError": $inputRoot
                }
              `,
            },
          },
        ],
      }
    }),
    {
      authorizationType: AuthorizationType.IAM,
      methodResponses: [{
        statusCode: "200"
      },
      {
        statusCode: "400"
      },
      {
        statusCode: "500"
      }]
    })
  }
}
