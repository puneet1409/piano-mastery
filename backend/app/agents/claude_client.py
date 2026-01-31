import os
from anthropic import Anthropic
from app.agents.prompts import generate_agent_prompt, parse_agent_decision, DecisionContext
from typing import Dict
import asyncio

def get_agent_decision(context: DecisionContext, model: str = "claude-sonnet-4-5-20250929") -> Dict:
    """Get agent decision using Claude API."""

    # Generate prompt
    prompt = generate_agent_prompt(context)

    # Initialize Claude client
    client = Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))

    # Call Claude API
    response = client.messages.create(
        model=model,
        max_tokens=1024,
        messages=[
            {"role": "user", "content": prompt}
        ]
    )

    # Extract text from response
    response_text = response.content[0].text

    # Parse decision
    decision = parse_agent_decision(response_text)

    return decision

async def get_agent_decision_async(context: DecisionContext) -> Dict:
    """Async wrapper for agent decision."""

    # Run synchronous Claude call in thread pool
    loop = asyncio.get_event_loop()
    decision = await loop.run_in_executor(None, get_agent_decision, context)

    return decision
