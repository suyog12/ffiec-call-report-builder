from app.clients.ffiec_client import FFIECClient


class PeriodService:

    def __init__(self):
        self.client = FFIECClient()

    async def get_periods(self):
        data = await self.client.retrieve_reporting_periods()

        # You can refine this later based on actual response structure
        return data