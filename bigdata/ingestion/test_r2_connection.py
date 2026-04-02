print("Script started")
import boto3

s3 = boto3.client(
    "s3",
    endpoint_url="https://59f7115a22f45d60a4d0111d2b306c4d.r2.cloudflarestorage.com",
    aws_access_key_id="c91906a92013e4c64e5209ba6293ac6f",
    aws_secret_access_key="de6df42ddf80b69a933c5d43ec304df044ab267f729a40f66aeca9bb068c7789",
    region_name="auto",
)


print("Client created")
objects = s3.list_objects_v2(Bucket="ffiec-data")
print("Objects in ffiec-data:", objects.get("KeyCount", 0))
print("R2 connection successful")