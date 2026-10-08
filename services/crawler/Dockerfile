FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY crawler ./crawler
CMD ["python", "-m", "crawler.run"]
