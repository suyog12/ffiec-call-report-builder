import base64
import json
import httpx
from app.config import settings


class FFIECClient:
    def __init__(self):
        self.base_url = settings.FFIEC_BASE_URL.rstrip("/")
        self.user_id = settings.FFIEC_USER_ID
        self.token = settings.FFIEC_PWS_TOKEN

    def _headers(self, extra_headers=None):
        headers = {
            "UserID": self.user_id,
            "Authentication": f"Bearer {self.token}",
        }
        if extra_headers:
            headers.update(extra_headers)
        return headers

    async def retrieve_reporting_periods(self):
        url = f"{self.base_url}/RetrieveReportingPeriods"

        headers = {
            "UserID": self.user_id,
            "Authentication": f"Bearer {self.token}",
            "dataSeries": "Call"
        }

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(url, headers=headers)

            # DEBUG -print response
            print("STATUS:", response.status_code)
            print("RESPONSE TEXT:", response.text)

            response.raise_for_status()
            return response.json()
    
    async def retrieve_panel_of_reporters(self, reporting_period: str):
        url = f"{self.base_url}/RetrievePanelOfReporters"

        headers = {
            "UserID": self.user_id,
            "Authentication": f"Bearer {self.token}",
            "dataSeries": "Call",
            "reportingPeriodEndDate": reporting_period,
        }

        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.get(url, headers=headers)

            print("STATUS:", response.status_code)
            print("RESPONSE TEXT:", response.text[:1000])

            response.raise_for_status()
            return response.json()
        
    async def retrieve_call_report_pdf(self, rssd_id: int, reporting_period: str):
        url = f"{self.base_url}/RetrieveFacsimile"

        headers = {
            "UserID": self.user_id,
            "Authentication": f"Bearer {self.token}",
            "dataSeries": "Call",
            "fiID": str(rssd_id),
            "fiIdType": "ID_RSSD",
            "reportingPeriodEndDate": reporting_period,
            "facsimileFormat": "PDF",
        }

        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.get(url, headers=headers)
            response.raise_for_status()

            raw_text = response.text.strip()

            # FFIEC returns a JSON string containing base64 PDF
            base64_pdf = json.loads(raw_text)
            pdf_bytes = base64.b64decode(base64_pdf)

            return pdf_bytes
        
    def _headers(self) -> dict:
        return {
            "UserID": settings.FFIEC_USER_ID,
            "Authentication": f"Bearer {settings.FFIEC_PWS_TOKEN}",
            "dataSeries": "Call",
        }

    async def get_facsimile(
        self,
        reporting_period: str,
        fi_id_type: str,
        fi_id: str | int,
        facsimile_format: str,
    ) -> httpx.Response:
        url = f"{self.base_url}/RetrieveFacsimile"
        headers = {
            **self._headers(),
            "reportingPeriodEndDate": reporting_period,
            "fiIdType": fi_id_type,
            "fiId": str(fi_id),
            "facsimileFormat": facsimile_format,
        }

        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.get(url, headers=headers)
            response.raise_for_status()
            return response