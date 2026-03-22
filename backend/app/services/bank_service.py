from app.clients.ffiec_client import FFIECClient


class BankService:
    def __init__(self):
        self.client = FFIECClient()

    async def get_banks(self, reporting_period: str):
        data = await self.client.retrieve_panel_of_reporters(reporting_period)
        return data